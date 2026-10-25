// A subtle colour grade per zone and a stepped vignette: one full-screen pass at the world-pixel
// size with nearest sampling, so no pixel is blurred. The grade follows the monk's zone and
// crossfades over about a second. The pass exists only while the grade is on.
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';

Effect.ShadersStore.zoneGradeFragmentShader = `precision highp float;
  varying vec2 vUV;
  uniform sampler2D textureSampler;
  uniform vec3 gain;
  uniform vec4 shape; // x saturation, y vignette step, z shadow cool, w contrast
  uniform vec2 size;
  // HD-2D atmos: zero preserves the exact stage-0 calculation.
  uniform float hdAtmos;
  uniform float hdCourtyard; // interpolated shadow-only ritual tint

  void main(void) {
    vec3 c = texture2D(textureSampler, vUV).rgb;
    float l = dot(c, vec3(.299, .587, .114));
    c = mix(vec3(l), c, shape.x);
    // Contrast pivots on the night's mid-tone, so dark stone and lit grass both keep their range.
    c = (c - .35) * shape.w + .35;
    c *= gain;
    // Shadows lean toward the night violet; highlights keep their colour.
    c = mix(c, c * vec3(.9, .92, 1.08), shape.z * (1.0 - smoothstep(.15, .55, l)));
    // HD-2D atmos: moonlit shadows preserve the amber and magenta emissive art.
    if (hdAtmos > .5) {
      float shadow = 1.0 - smoothstep(.08, .5, l);
      // Neutral stone, sand and skin above the shadow range keep their own hue.
      vec3 nightTint = mix(vec3(.82, 1.06, 1.10), vec3(1.08, .96, 1.07), hdCourtyard);
      c = mix(c, c * nightTint + vec3(.004, .009, .011), shadow * .46);
      float warm = smoothstep(.20, .65, l) * smoothstep(.025, .18, c.r - c.b);
      c += vec3(.045, .021, .002) * warm;
    }
    // A rounded-rectangle vignette in three hard steps. No dither: a screen-fixed pattern would
    // crawl over the scrolling ground.
    vec2 p = (vUV - .5) * vec2(size.x / size.y, 1.0) * 2.0;
    float r = length(max(abs(p) - vec2(size.x / size.y - .9, .1), 0.0)) / .9;
    c *= 1.0 - (step(.8, r) + step(1.0, r) + step(1.2, r)) * shape.y;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

// gain multiplies the colour; saturation 1 and contrast 1 keep the art. The courtyard stays
// close to the art: its pale stone and dark grass keep their contrast.
export const ZONE_GRADES = {
  camp: { gain: [1, .96, .9], saturation: .95, contrast: 1.04, vignette: .045, cool: .3 },
  road: { gain: [.93, .95, .99], saturation: .9, contrast: 1.04, vignette: .05, cool: .45 },
  courtyard: { gain: [.98, .96, .99], saturation: .95, contrast: 1.05, vignette: .045, cool: .25 },
  cemetery: { gain: [.88, .94, .98], saturation: .78, contrast: 1.06, vignette: .06, cool: .6 },
  orchard: { gain: [.99, .98, .9], saturation: .96, contrast: 1.03, vignette: .045, cool: .25 },
};
// HD-2D atmos: keep each district's palette; the existing pass stays nearest-sampled.
export const HD_ZONE_GRADES = {
  camp: { gain: [.94, .91, .85], saturation: .94, contrast: 1.07, vignette: .052, cool: .28 },
  road: { gain: [.91, .89, .83], saturation: .92, contrast: 1.06, vignette: .055, cool: .20 },
  courtyard: { gain: [.90, .90, .90], saturation: .96, contrast: 1.06, vignette: .05, cool: .13 },
  cemetery: { gain: [.68, .82, .94], saturation: .77, contrast: 1.10, vignette: .065, cool: .44 },
  orchard: { gain: [.87, .92, .81], saturation: .94, contrast: 1.06, vignette: .05, cool: .25 },
};
const FIELDS = ['saturation', 'contrast', 'vignette', 'cool'];

// One crossfade step of `current` toward `target`, in place. Without a current grade it starts
// at the target; without elapsed time (a pause) it holds.
export function blendGrade(current, target, dt) {
  if (!current) return { gain: [...target.gain], ...Object.fromEntries(FIELDS.map(key => [key, target[key]])) };
  const k = dt > 0 ? 1 - Math.exp(-dt * 2.5) : 0;
  for (let i = 0; i < 3; i++) current.gain[i] += (target.gain[i] - current.gain[i]) * k;
  for (const key of FIELDS) current[key] += (target[key] - current[key]) * k;
  return current;
}

export class ZoneGrade {
  constructor(camera) {
    this.camera = camera;
    this.pass = null;
    this.attached = false;
    this.current = null;
    this.atmosTier = 'off';
    this.courtyardMix = 0;
  }

  // HD-2D atmos: reset the blend when toggling so off restores today's grade immediately.
  setAtmosphere(tier) {
    const next = tier === 'low' || tier === 'high' ? tier : 'off';
    if (this.atmosTier === next) return;
    this.atmosTier = next;
    if (next === 'off') this.courtyardMix = 0;
    this.current = null;
  }

  // zoneId: an id of ZONE_GRADES, or null for no grade (the pass is then released).
  update(zoneId, dt) {
    const target = (this.atmosTier === 'off' ? ZONE_GRADES : HD_ZONE_GRADES)[zoneId];
    if (!target) return this.dispose();
    // Match the grade crossfade; a paused frame does not change shadow hue.
    if (this.atmosTier !== 'off') {
      const amount = Number(zoneId === 'courtyard'), k = dt > 0 ? 1 - Math.exp(-dt * 2.5) : 0;
      this.courtyardMix = this.current ? this.courtyardMix + (amount - this.courtyardMix) * k : amount;
    }
    this.current = blendGrade(this.current, target, dt);
    if (!this.pass) {
      // The pass compiles detached: an attached pass that is not ready yet would leave the frame blank.
      this.pass = new PostProcess('zone-grade', 'zoneGrade', ['gain', 'shape', 'size', 'hdAtmos', 'hdCourtyard'], null, 1, null,
        Texture.NEAREST_SAMPLINGMODE, this.camera.getScene().getEngine());
      this.pass.onApply = effect => {
        const g = this.current;
        effect.setFloat('hdAtmos', Number(this.atmosTier !== 'off'));
        effect.setFloat('hdCourtyard', this.courtyardMix);
        effect.setFloat3('gain', g.gain[0], g.gain[1], g.gain[2]);
        effect.setFloat4('shape', g.saturation, g.vignette, g.cool, g.contrast);
        effect.setFloat2('size', this.pass.width, this.pass.height);
      };
    }
    if (!this.attached && this.pass.isReady()) {
      this.camera.attachPostProcess(this.pass);
      this.attached = true;
    }
  }

  dispose() {
    if (this.attached) this.camera.detachPostProcess(this.pass);
    this.pass?.dispose();
    this.pass = null;
    this.attached = false;
    this.current = null;
  }
}
