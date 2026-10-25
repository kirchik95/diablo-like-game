// Tilt-shift in the existing world framebuffer. No depth prepass, actor material changes,
// device-resolution buffers or temporal noise. The HUD/effects canvas is outside this pass.
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export const id = 'dof';
export const order = 90;
const DOF = /dof|depth.of.field|circle of confusion/i;

Effect.ShadersStore.hd2dDofFragmentShader = `precision highp float;
  varying vec2 vUV;
  uniform sampler2D textureSampler;
  uniform vec2 size;
  uniform vec4 focus; // monk foot UV, sharp half-band, feather, maximum mix
  uniform float radius;
  vec3 sampleAt(vec2 offset) {
    return texture2D(textureSampler, clamp(vUV + offset / size, .5 / size, 1.0 - .5 / size)).rgb;
  }
  void main(void) {
    vec4 source = texture2D(textureSampler, vUV);
    // Shift toward the torso by 5% of frame height. The entire middle half stays exact.
    float coc = smoothstep(focus.y, focus.y + focus.z, abs(vUV.y - focus.x - .05));
    if (coc <= 0.0) { gl_FragColor = source; return; }
#ifdef DOF_HIGH
    // A fixed disk, with a gentle highlight bias: no random sampling or shimmering.
    vec3 sum = source.rgb;
    float weights = 1.0;
    for (int ring = 1; ring <= 2; ring++) {
      float r = ring == 1 ? 1.0 : radius;
      float d = ring == 1 ? 1.0 : floor(radius * .7071 + .5);
      for (int i = 0; i < 8; i++) {
        vec2 o;
        if (i == 0) o = vec2(r, 0.0);
        else if (i == 1) o = vec2(-r, 0.0);
        else if (i == 2) o = vec2(0.0, r);
        else if (i == 3) o = vec2(0.0, -r);
        else if (i == 4) o = vec2(d, d);
        else if (i == 5) o = vec2(-d, d);
        else if (i == 6) o = vec2(d, -d);
        else o = vec2(-d, -d);
        vec3 c = sampleAt(o);
        float w = 1.0 + .45 * max(c.r, max(c.g, c.b));
        sum += c * w; weights += w;
      }
    }
    vec3 soft = sum / weights;
#else
    // Nine integer texel taps. Nearest sampling also preserves all untouched source pixels.
    vec3 soft = source.rgb * .25;
    soft += (sampleAt(vec2(1.0, 0.0)) + sampleAt(vec2(-1.0, 0.0))
           + sampleAt(vec2(0.0, 1.0)) + sampleAt(vec2(0.0, -1.0))) * .125;
    soft += (sampleAt(vec2(1.0, 1.0)) + sampleAt(vec2(-1.0, 1.0))
           + sampleAt(vec2(1.0, -1.0)) + sampleAt(vec2(-1.0, -1.0))) * .0625;
#endif
    gl_FragColor = vec4(mix(source.rgb, soft, coc * focus.w), source.a);
  }`;

// GL UV of the actual drawn foot, including camera follow lag and shake. Scratch objects
// belong to the instance; this runs before scene.render(), so refresh both camera matrices.
export function focusAnchor(camera, position, transform, projected) {
  camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), transform);
  Vector3.TransformCoordinatesToRef(position, transform, projected);
  return Number.isFinite(projected.y) ? (projected.y + 1) * .5 : .5;
}

export function install({ engine, camera, renderer, tier = 'off' }) {
  const transform = new Matrix(), projected = new Vector3();
  let current = 'off', pass = null, attached = false, disposed = false, anchor = .5;
  function detach(target) {
    const index = camera._postProcesses.indexOf(target);
    if (index < 0) return;
    camera.detachPostProcess(target);
    // Remove only this detached slot; foreign holes and passes keep their identity.
    camera._postProcesses.splice(index, 1);
    camera._cascadePostProcessesToRigCams();
  }
  function passOrder(target) {
    return target.metadata?.hd2dOrder ?? (target.name === 'zone-grade' ? 60 : DOF.test(target.name) ? order : 0);
  }
  function keepOrder() {
    const chain = camera._postProcesses;
    // Same stable ordering as bloom, including grades that finish compiling later.
    // An ordered chain performs no detach/attach or render-target invalidation.
    for (let i = 1; i < chain.length; i++) {
      const target = chain[i];
      if (!target) continue;
      const rank = passOrder(target);
      let at = 0;
      while (at < i && (!chain[at] || passOrder(chain[at]) <= rank)) at++;
      if (at === i) continue;
      detach(target);
      camera.attachPostProcess(target, at);
    }
  }
  function release() {
    if (attached) detach(pass);
    pass?.dispose();
    pass = null; attached = false;
  }
  function setTier(next) {
    if (disposed) return;
    next = next === 'low' || next === 'high' ? next : 'off';
    if (next === current) return;
    release(); current = next;
    if (current === 'off') return;
    // Compile detached. Until ready, keep rendering the original sharp frame.
    pass = new PostProcess('hd2d-dof', 'hd2dDof', ['size', 'focus', 'radius'], null,
      1, null, Texture.NEAREST_SAMPLINGMODE, engine, false, current === 'high' ? '#define DOF_HIGH' : null);
    pass.metadata = { hd2dOrder: order };
    // Keep Babylon's input clear: this can be the first pass when zoneGrade is off.
    pass.onApply = effect => {
      effect.setFloat2('size', pass.width, pass.height);
      effect.setFloat4('focus', anchor, .25, .18, current === 'high' ? .85 : .65);
      effect.setFloat('radius', renderer.coarsePointer ? 2 : 3);
    };
  }
  setTier(tier);
  return {
    setTier,
    update() {
      if (!pass || disposed) return;
      const position = renderer.monk?.mesh?.position;
      anchor = position ? focusAnchor(camera, position, transform, projected) : .5;
      if (!attached && pass.isReady()) {
        camera.attachPostProcess(pass);
        attached = true;
      }
      if (attached) keepOrder();
    },
    dispose() { release(); disposed = true; },
  };
}
