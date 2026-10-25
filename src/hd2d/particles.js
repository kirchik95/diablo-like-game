// Living air. One pooled draw, no texture, no post-process, no gameplay randomness.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { inSideArea } from '../side-zones.js';

export const id = 'particles';
export const order = 50;
const COUNT = 96;
const ZONES = { camp: 0, road: 1, courtyard: 2, cemetery: 3, orchard: 4 };

// Same side boxes / spine seams as country-zones, compiled only on a world rebuild.
// Indexed loops avoid allocating find/findIndex callbacks on every rendered frame.
function zoneLookup(world) {
  if (!world?.zones?.length) return () => world;
  const sides = [], bands = [];
  for (const zone of world.zones) {
    if (zone.area) sides.push(zone);
    else {
      let minY = Infinity, maxY = -Infinity;
      for (const p of zone.tiles) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      bands.push({ zone, minY, maxY });
    }
  }
  bands.sort((a, b) => b.maxY - a.maxY);
  const seams = bands.slice(0, -1).map((band, i) => (band.minY + bands[i + 1].maxY) / 2);
  return (x, y) => {
    for (let i = 0; i < sides.length; i++) {
      const a = sides[i].area;
      if (inSideArea(a, x, y)) return sides[i];
    }
    for (let i = 0; i < seams.length; i++) if (y >= seams[i]) return bands[i].zone;
    return bands[bands.length - 1]?.zone ?? null;
  };
}

const vertexSource = `
precision highp float;
attribute vec3 position;
attribute vec4 particle;
uniform mat4 viewProjection;
uniform vec2 resolution;
uniform vec4 field;
uniform vec3 emitter0;
uniform vec3 emitter1;
uniform vec3 emitter2;
uniform vec3 emitter3;
uniform float zone;
uniform float clock;
uniform float strength;
varying vec2 uv;
varying vec2 shapeSize;
varying vec4 ink;
varying float kind;
varying float seed;
void main() {
  seed = particle.x;
  float t = clock;
  float phase = fract(particle.y + t * (0.055 + seed * 0.035));
  float slot = particle.z;
  uv = position.xy;
  vec3 p;
  vec2 size = vec2(1.0);
  vec3 color;
  float alpha = 1.0;
  kind = 0.0;
  // Camera-near air is tiled in world space, so a moving camera never drags it.
  vec2 drift = vec2(t * 0.12, t * -0.045);
  vec2 extent = field.zw;
  vec2 air = field.xy + mod(vec2(seed * 251.0, particle.y * 179.0) + drift - field.xy + extent * 0.5, extent) - extent * 0.5;
  p = vec3(air.x, 0.3 + particle.w * 2.2, air.y);
  float edge = min(min((air.x - field.x) / extent.x + 0.5, 0.5 - (air.x - field.x) / extent.x),
                   min((air.y - field.y) / extent.y + 0.5, 0.5 - (air.y - field.y) / extent.y));
  float airFade = smoothstep(0.0, 0.12, edge);
  float life = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.7, 1.0, phase));
  if (zone < 0.5) {
    bool smoke = slot < 2.0;
    p = emitter0 + vec3(sin(seed * 55.0 + phase * 3.0) * (0.2 + phase * 0.7) + phase * 0.6,
                       0.5 + phase * (smoke ? 3.4 : 2.5), cos(seed * 39.0) * 0.25);
    kind = smoke ? 1.0 : 0.0;
    size = smoke ? vec2(9.0 + floor(phase * 10.0), 7.0 + floor(phase * 8.0)) : vec2(1.0 + step(0.7, seed));
    color = smoke ? vec3(0.29, 0.30, 0.32) : mix(vec3(2.5, 0.65, 0.12), vec3(2.8, 1.65, 0.42), particle.w);
    alpha = life * (smoke ? 0.14 : 0.85);
  } else if (zone < 1.5) {
    bool moth = slot < 2.0;
    if (moth) {
      vec3 source = particle.w < 0.25 ? emitter0 : particle.w < 0.5 ? emitter1 : particle.w < 0.75 ? emitter2 : emitter3;
      p = source + vec3(sin(t * 0.7 + seed * 40.0) * 0.6, 0.9 + cos(t * 0.5 + seed * 20.0) * 0.4, cos(t * 0.6 + seed * 60.0) * 0.6);
      kind = 3.0;
      size = vec2(3.0, 2.0);
    }
    color = moth ? vec3(0.72, 0.66, 0.47) : vec3(0.66, 0.58, 0.43);
    alpha = moth ? 0.7 : 0.24 * airFade;
  } else if (zone < 2.5) {
    bool ash = slot < 2.0;
    if (!ash) {
      float a = seed * 45.0 + t * 0.12;
      float radius = 0.6 + particle.w * 2.0;
      p = emitter0 + vec3(cos(a) * radius, 0.35 + phase * 2.1, sin(a) * radius);
      size = vec2(1.0 + step(0.84, seed));
    }
    color = ash ? vec3(0.54, 0.5, 0.56) : mix(vec3(1.8, 0.22, 1.3), vec3(0.65, 2.0, 1.8), step(0.65, particle.w));
    alpha = ash ? 0.3 * airFade : life * 0.7;
  } else if (zone < 3.5) {
    bool sheet = slot < 1.0;
    if (sheet) {
      p.y = 0.18 + particle.w * 0.18;
      kind = 2.0;
      size = vec2(48.0 + floor(seed * 30.0), 10.0 + floor(seed * 6.0));
    } else {
      p.y = 0.4 + particle.w * 1.8 + sin(t * 0.4 + seed * 40.0) * 0.16;
      size = vec2(1.0 + step(0.82, seed));
    }
    color = sheet ? vec3(0.34, 0.5, 0.48) : vec3(0.65, 2.1, 1.85);
    alpha = airFade * (sheet ? 0.12 : 0.32 + 0.22 * sin(t * 0.55 + seed * 60.0));
  } else {
    bool leaf = slot < 2.0;
    if (leaf) {
      p.y = (1.0 - phase) * 3.5;
      p.x += sin(phase * 7.0 + seed * 40.0) * 0.6;
      size = vec2(3.0, 2.0);
      kind = 4.0;
    } else {
      p.y = 0.35 + particle.w * 1.2 + sin(t * 0.5 + seed * 20.0) * 0.2;
      size = vec2(1.0 + step(0.9, seed));
    }
    color = leaf ? mix(vec3(0.57, 0.45, 0.24), vec3(0.63, 0.58, 0.3), particle.w) : vec3(1.75, 2.2, 0.65);
    alpha = airFade * (leaf ? life * 0.75 : 0.35 + 0.3 * sin(t * 0.8 + seed * 45.0));
  }
  // Every quad edge lands on the low-resolution world framebuffer's pixel lattice.
  vec4 clip = viewProjection * vec4(p, 1.0);
  vec2 centre = floor((clip.xy / clip.w * 0.5 + 0.5) * resolution);
  centre += size * (position.xy - 0.5);
  centre = floor(centre);
  clip.xy = (centre / resolution * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
  shapeSize = size;
  ink = vec4(color, alpha * strength);
}`;

const fragmentSource = `
precision highp float;
varying vec2 uv;
varying vec2 shapeSize;
varying vec4 ink;
varying float kind;
varying float seed;
void main() {
  vec2 q = (floor(uv * shapeSize) + 0.5) / shapeSize;
  float mask = 1.0;
  if (kind > 0.5 && kind < 2.5) {
    // Clustered lobes form drawn, stepped sheets with broad gaps, never scanline noise.
    vec2 a = (q - vec2(0.27, 0.54)) / vec2(0.28, 0.35);
    vec2 b = (q - vec2(0.53, 0.43)) / vec2(0.34, 0.43);
    vec2 c = (q - vec2(0.77, 0.56)) / vec2(0.24, 0.29);
    float d = min(min(dot(a, a), dot(b, b)), dot(c, c));
    if (d > 1.0) discard;
    mask = d < 0.35 ? 1.0 : d < 0.7 ? 0.65 : 0.3;
  } else if (kind > 2.5) {
    // A three-pixel wing / leaf silhouette, not a blurred point sprite.
    if (q.x > 0.34 && q.x < 0.67 && q.y > 0.5) discard;
  }
  if (ink.a < 0.002) discard;
  gl_FragColor = vec4(ink.rgb, ink.a * mask);
}`;

function createPool(scene) {
  const mesh = new Mesh('hd2d-particles', scene);
  const positions = new Float32Array(COUNT * 12);
  const particles = new Float32Array(COUNT * 16);
  const indices = new Uint16Array(COUNT * 6);
  for (let i = 0; i < COUNT; i++) {
    const seed = ((i * 73 + 19) % 997) / 997;
    const phase = ((i * 137 + 47) % 991) / 991;
    const jitter = ((i * 251 + 61) % 983) / 983;
    for (let v = 0; v < 4; v++) {
      const p = i * 12 + v * 3, a = i * 16 + v * 4;
      positions[p] = v === 1 || v === 2 ? 1 : 0;
      positions[p + 1] = v >= 2 ? 1 : 0;
      particles[a] = seed; particles[a + 1] = phase;
      particles[a + 2] = i % 8; particles[a + 3] = jitter;
    }
    const at = i * 6, base = i * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], at);
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, false, 3);
  mesh.setVerticesData('particle', particles, false, 4);
  mesh.setIndices(indices);
  // Halving indexCount makes this non-global; transparent sorting still needs bounds.
  mesh.subMeshes[0].setBoundingInfo(mesh.getBoundingInfo());
  mesh.isPickable = false;
  // Standing sprites share this depth buffer; air can pass in front or behind them.
  mesh.renderingGroupId = 1;
  mesh.alwaysSelectAsActiveMesh = true; // Shader positions replace the small CPU bounds.
  mesh.doNotSyncBoundingInfo = true;
  mesh.freezeWorldMatrix();
  const material = new ShaderMaterial('hd2d-particles-ink', scene, { vertexSource, fragmentSource }, {
    attributes: ['position', 'particle'],
    uniforms: ['viewProjection', 'resolution', 'field', 'emitter0', 'emitter1', 'emitter2', 'emitter3', 'zone', 'clock', 'strength'],
    needAlphaBlending: true,
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alphaMode = Material.ALPHA_COMBINE;
  mesh.material = material;
  return mesh;
}

// Explicit selective-bloom contract: renderer.hd2dParticleBloom = { rects, count }.
// Rects are bottom-left post-process UV bounds of visible luminous quads only.
// Mirror the vertex animation using the uploaded Float32 seeds; CPU mesh bounds
// deliberately remain unit quads. One world-pixel margin covers snap/float error.
const fract = value => value - Math.floor(value);
const mod = (value, span) => value - span * Math.floor(value / span);
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function emissionBounds(out, seeds, count, zone, clock, fade, field, origin, camera, width, height) {
  out.count = 0;
  if (fade <= 0 || zone === 1) return; // Road dust and moths are not emissive.
  camera.getViewMatrix(); camera.getProjectionMatrix();
  const m = camera.getTransformationMatrix().m, t = Math.fround(clock);
  for (let i = 0; i < count; i++) {
    const at = i * 16, seed = seeds[at], start = seeds[at + 1], slot = seeds[at + 2], jitter = seeds[at + 3];
    if (zone === 3 ? slot === 0 : slot < 2) continue; // Smoke, ash, sheets and leaves.
    const phase = fract(Math.fround(start + Math.fround(t * Math.fround(.055 + seed * .035))));
    let x, y, z, alpha;
    if (zone === 0) {
      x = Math.fround(origin.x) + Math.sin(seed * 55 + phase * 3) * (.2 + phase * .7) + phase * .6;
      y = .5 + phase * 2.5; z = Math.fround(origin.z) + Math.cos(seed * 39) * .25;
      alpha = smooth(0, .12, phase) * (1 - smooth(.7, 1, phase)) * .85;
    } else if (zone === 2) {
      const a = seed * 45 + t * .12, radius = .6 + jitter * 2;
      x = Math.fround(origin.x) + Math.cos(a) * radius;
      y = .35 + phase * 2.1; z = Math.fround(origin.z) + Math.sin(a) * radius;
      alpha = smooth(0, .12, phase) * (1 - smooth(.7, 1, phase)) * .7;
    } else {
      const fx = Math.fround(field.x), fz = Math.fround(field.y), span = Math.fround(field.z);
      x = fx + mod(seed * 251 + t * .12 - fx + span * .5, span) - span * .5;
      z = fz + mod(start * 179 - t * .045 - fz + span * .5, span) - span * .5;
      const edge = Math.min((x - fx) / span + .5, .5 - (x - fx) / span,
        (z - fz) / span + .5, .5 - (z - fz) / span);
      if (zone === 3) {
        y = .4 + jitter * 1.8 + Math.sin(t * .4 + seed * 40) * .16;
        alpha = smooth(0, .12, edge) * (.32 + .22 * Math.sin(t * .55 + seed * 60));
      } else {
        y = .35 + jitter * 1.2 + Math.sin(t * .5 + seed * 20) * .2;
        alpha = smooth(0, .12, edge) * (.35 + .3 * Math.sin(t * .8 + seed * 45));
      }
    }
    if (alpha * fade < .002) continue;
    const w = x * m[3] + y * m[7] + z * m[11] + m[15];
    if (w <= 0) continue;
    const depth = (x * m[2] + y * m[6] + z * m[10] + m[14]) / w;
    if (depth < -1 || depth > 1) continue;
    const u = Math.floor(((x * m[0] + y * m[4] + z * m[8] + m[12]) / w * .5 + .5) * width);
    const v = Math.floor(((x * m[1] + y * m[5] + z * m[9] + m[13]) / w * .5 + .5) * height);
    const large = seed >= (zone === 0 ? .7 : zone === 2 ? .84 : zone === 3 ? .82 : .9);
    const half = large ? 1 : .5;
    const left = Math.floor(u - half) - 1, right = Math.floor(u + half) + 1;
    const bottom = Math.floor(v - half) - 1, top = Math.floor(v + half) + 1;
    if (right <= 0 || left >= width || top <= 0 || bottom >= height) continue;
    const offset = out.count++ * 4;
    out.rects[offset] = Math.max(0, left / width);
    out.rects[offset + 1] = Math.max(0, bottom / height);
    out.rects[offset + 2] = Math.min(1, right / width);
    out.rects[offset + 3] = Math.min(1, top / height);
  }
}

export function install(ctx) {
  let renderer = ctx.renderer, tier = 'off', mesh = null, disposed = false, bloom = null, seeds = null;
  let world = null, lookup = null, zones = null, current = null, pending = null, fade = 0;
  const resolution = new Vector2(), field = new Vector4();
  const emitters = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  function onWorld(next = renderer) {
    if (bloom) {
      bloom.count = 0;
      if (renderer !== next && renderer.hd2dParticleBloom === bloom) delete renderer.hd2dParticleBloom;
      next.hd2dParticleBloom = bloom;
    }
    renderer = next;
    world = renderer.world?.data ?? renderer.game?.world ?? null;
    lookup = zoneLookup(world);
    zones = new Map();
    for (const zone of world?.zones ?? (world ? [world] : [])) {
      const sources = [];
      if (zone.id === 'camp') {
        const fire = zone.setDressing?.find(p => p.kind === 'campfire-base');
        if (fire) sources.push(fire.collider ?? fire.contact ?? fire);
        else if (zone.braziers?.length) sources.push(zone.braziers[0]);
      } else if (zone.id === 'courtyard' && zone.ritual) sources.push(zone.ritual);
      else {
        for (const p of zone.setDressing ?? []) if (p.kind === 'stone-lantern') sources.push(p.collider ?? p.contact ?? p);
        for (const p of zone.braziers ?? []) sources.push(p);
        for (const p of zone.shrines ?? []) sources.push(p);
      }
      zones.set(zone, sources);
    }
    current = pending = null; fade = 0;
  }
  function choose(zone) {
    current = zone;
    const sources = zones.get(zone);
    for (let i = 0; i < 4; i++) {
      // Missing local sources are offscreen; ambient air still works normally.
      const p = sources[i % sources.length];
      emitters[i].set(p?.x ?? 1e5, 0, p?.y ?? 1e5);
      mesh.material.setVector3(`emitter${i}`, emitters[i]);
    }
    mesh.material.setFloat('zone', ZONES[zone.id] ?? 1);
  }
  function setTier(next) {
    if (disposed) return;
    tier = next === 'low' || next === 'high' ? next : 'off';
    if (tier === 'off') { if (bloom) bloom.count = 0; mesh?.setEnabled(false); return; }
    if (!mesh) {
      mesh = createPool(ctx.scene); seeds = mesh.getVerticesData('particle');
      bloom = { rects: new Float32Array(COUNT * 4), count: 0 };
      onWorld();
    }
    mesh.subMeshes[0].indexCount = (tier === 'low' ? COUNT / 2 : COUNT) * 6;
    mesh.setEnabled(true);
  }
  function update(dt, time) {
    if (disposed || tier === 'off') return;
    const data = renderer.world?.data ?? renderer.game?.world ?? null;
    if (data !== world) onWorld();
    const target = ctx.camera.target;
    const zone = lookup?.(target.x, target.z);
    if (!zone || !(zone.id in ZONES)) { bloom.count = 0; mesh.setEnabled(false); return; }
    mesh.setEnabled(true);
    if (!current) choose(zone);
    pending = zone;
    const step = Math.min(0.1, Math.max(0, dt)) * 4;
    if (pending !== current) {
      fade = Math.max(0, fade - step);
      if (fade === 0) choose(pending);
    } else fade = Math.min(1, fade + step);
    resolution.set(ctx.engine.getRenderWidth(), ctx.engine.getRenderHeight());
    const camera = ctx.camera;
    // A camera-centred square covers the isometric view with a small fade margin.
    const span = Math.max(camera.orthoRight - camera.orthoLeft || 24, (camera.orthoTop - camera.orthoBottom || 12) * 2) * 1.5;
    field.set(target.x, target.z, span, span);
    const material = mesh.material;
    material.setVector2('resolution', resolution);
    material.setVector4('field', field);
    material.setFloat('clock', renderer.reducedMotion ? 0 : time);
    material.setFloat('strength', fade);
    emissionBounds(bloom, seeds, tier === 'low' ? COUNT / 2 : COUNT, ZONES[current.id],
      renderer.reducedMotion ? 0 : time, fade, field, emitters[0], camera, resolution.x, resolution.y);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (bloom) {
      bloom.count = 0;
      if (renderer.hd2dParticleBloom === bloom) delete renderer.hd2dParticleBloom;
    }
    bloom = seeds = null;
    const material = mesh?.material;
    mesh?.dispose(); material?.dispose();
    mesh = null; zones = null; lookup = null; world = null;
  }
  setTier(ctx.tier);
  return { setTier, update, onWorld, dispose };
}
