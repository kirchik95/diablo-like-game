// Selective, additive bloom. Scene colour is retained at world-pixel resolution;
// only bright pixels inside actual emitter bounds enter the half-size halo chain.
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';

export const id = 'bloom';
export const order = 80;
const MAX_SOURCES = 24;
const DOF = /dof|depth.of.field|circle of confusion/i;
const SOURCE = /(?:flame|brazier-\d|cache-(?!pool)|stone-lantern|wall-window|ritual-(?:seal|binding|\d)|shrine-|amber-bead|reward-inlay|spirit-shot-|monk-shot-(?!shadow)|fx-(?:impact|healing)|loot-(?:ring|beam|glint))/;

Effect.ShadersStore.hdBloomExtractFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 sourceSize;
uniform vec4 emitters[24];
uniform vec4 hero;
uniform float count;
float inside(vec2 p, vec4 r) {
  return step(r.x,p.x)*step(r.y,p.y)*step(p.x,r.z)*step(p.y,r.w);
}
vec3 bright(vec2 uv) {
  vec3 c=texture2D(textureSampler,uv).rgb;
  // Reject ordinary green, neutral stone and the warm low-saturation skin ramp.
  float teal=step(c.r+.10,min(c.g,c.b));
  float magenta=step(c.g+.10,min(c.r,c.b));
  float amber=step(.94,c.r)*step(.48,c.g)*step(c.b,.56)*step(c.b*1.75,c.g);
  float energy=smoothstep(.62,.94,max(c.r,max(c.g,c.b)));
  float mask=energy*max(teal,max(magenta,amber));
  // Sparse highlights: avoid walking the emitter list on ordinary ground.
  if (mask<=0.0 || inside(uv,hero)>0.0) return vec3(0.0);
  for (int i=0;i<24;i++) {
    if (float(i)>=count) break;
    if (inside(uv,emitters[i])>0.0) return c*mask;
  }
  return vec3(0.0);
}
void main(void) {
  // Four individual nearest texels, thresholded BEFORE averaging. No bright
  // grass/skin leakage from a bilinear downsample, and small sparks survive.
  vec2 p=(floor(vUV*sourceSize*.5)*2.0+.5)/sourceSize;
  vec2 d=1.0/sourceSize;
  gl_FragColor=vec4((bright(p)+bright(p+vec2(d.x,0.0))+
    bright(p+vec2(0.0,d.y))+bright(p+d))*.25,1.0);
}`;
Effect.ShadersStore.hdBloomBlurFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 delta;
void main(void) {
  vec3 c=texture2D(textureSampler,vUV).rgb*.375;
  c+=(texture2D(textureSampler,vUV-delta).rgb+texture2D(textureSampler,vUV+delta).rgb)*.25;
  c+=(texture2D(textureSampler,vUV-delta*2.0).rgb+texture2D(textureSampler,vUV+delta*2.0).rgb)*.0625;
  gl_FragColor=vec4(c,1.0);
}`;
Effect.ShadersStore.hdBloomMergeFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D baseSampler;
uniform float weight;
void main(void) {
  vec4 base=texture2D(baseSampler,vUV);
  gl_FragColor=vec4(base.rgb+texture2D(textureSampler,vUV).rgb*weight,base.a);
}`;

// Project the mesh's existing world bounds; caller supplies storage. No vectors
// or arrays are made on the frame path. Coordinates match post-process UVs.
function bounds(mesh, matrix, out, offset) {
  if (!mesh || mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) return false;
  mesh.computeWorldMatrix();
  let left=2, bottom=2, right=-1, top=-1;
  const m=matrix.m, points=mesh.getBoundingInfo().boundingBox.vectorsWorld;
  for (let i=0;i<points.length;i++) {
    const p=points[i], w=p.x*m[3]+p.y*m[7]+p.z*m[11]+m[15];
    if (w<=0) continue;
    const x=(p.x*m[0]+p.y*m[4]+p.z*m[8]+m[12])/w*.5+.5;
    const y=(p.x*m[1]+p.y*m[5]+p.z*m[9]+m[13])/w*.5+.5;
    left=Math.min(left,x); right=Math.max(right,x); bottom=Math.min(bottom,y); top=Math.max(top,y);
  }
  if (right<0 || left>1 || top<0 || bottom>1 || left>right) return false;
  out[offset]=left; out[offset+1]=bottom; out[offset+2]=right; out[offset+3]=top;
  return true;
}

export function install({ scene, engine, camera, renderer, tier = 'off' }) {
  const emitters=new Float32Array(MAX_SOURCES*4), hero=new Float32Array(4);
  const sources=[];
  let passes=null, attached=false, disposed=false, current='off', count=0;
  let added=null, removed=null, world=null;
  const add=mesh=>{ if (SOURCE.test(mesh.name) && !sources.includes(mesh)) sources.push(mesh); };
  const remove=mesh=>{ const i=sources.indexOf(mesh); if (i>=0) sources.splice(i,1); };
  // Explicit GPU-particle bounds bypass name/CPU-geometry discovery. Coalesce
  // only overlapping rectangles, or the cheapest union when the 24 slots fill.
  // Existing emitter coverage is never dropped, and no extra uniforms/RT are used.
  function appendParticle(left, bottom, right, top) {
    let best = -1, growth = Infinity;
    for (let i = 0; i < count; i++) {
      const at = i * 4;
      const l = emitters[at], b = emitters[at + 1], r = emitters[at + 2], t = emitters[at + 3];
      if (left <= r && right >= l && bottom <= t && top >= b) { best = i; break; }
      if (count === MAX_SOURCES) {
        const extra = (Math.max(r, right) - Math.min(l, left)) * (Math.max(t, top) - Math.min(b, bottom)) - (r - l) * (t - b);
        if (extra < growth) { growth = extra; best = i; }
      }
    }
    if (best < 0) {
      const at = count++ * 4;
      emitters[at] = left; emitters[at + 1] = bottom; emitters[at + 2] = right; emitters[at + 3] = top;
    } else {
      const at = best * 4;
      emitters[at] = Math.min(emitters[at], left); emitters[at + 1] = Math.min(emitters[at + 1], bottom);
      emitters[at + 2] = Math.max(emitters[at + 2], right); emitters[at + 3] = Math.max(emitters[at + 3], top);
    }
  }
  function detach(pass) {
    const index=camera._postProcesses.indexOf(pass);
    if (index<0) return;
    camera.detachPostProcess(pass);
    // Babylon leaves a null slot. Remove only our detached slot so repeated
    // toggles do not grow the chain; refresh rig copies after the compaction.
    camera._postProcesses.splice(index,1);
    camera._cascadePostProcessesToRigCams();
  }
  function passOrder(pass) {
    return pass.metadata?.hd2dOrder ?? (pass.name==='zone-grade'?60:DOF.test(pass.name)?90:0);
  }
  function keepOrder() {
    const chain=camera._postProcesses;
    // Earlier passes can compile/attach later (notably zone-grade). Fix only
    // actual inversions, using the same order on initial enable and toggles.
    for (let i=1;i<chain.length;i++) {
      const pass=chain[i];
      if (!pass) continue;
      const rank=passOrder(pass);
      let at=0;
      while (at<i && (!chain[at] || passOrder(chain[at])<=rank)) at++;
      if (at===i) continue;
      camera.detachPostProcess(pass);
      chain.splice(i,1);
      camera.attachPostProcess(pass,at);
    }
  }
  function release() {
    if (passes) for (const pass of passes) {
      detach(pass);
      pass.dispose();
    }
    passes=null; attached=false;
    if (added) scene.onNewMeshAddedObservable.remove(added);
    if (removed) scene.onMeshRemovedObservable.remove(removed);
    added=removed=null; sources.length=0;
  }
  function syncWorld() {
    world=renderer.world;
    for (const prop of world?.props ?? []) {
      if (/^(?:stone-lantern|wall-window)/.test(prop.placement?.kind) && !sources.includes(prop.mesh)) sources.push(prop.mesh);
    }
  }
  function create() {
    for (const mesh of scene.meshes) add(mesh);
    syncWorld();
    added=scene.onNewMeshAddedObservable.add(add);
    removed=scene.onMeshRemovedObservable.add(remove);
    // Babylon sizes each pass's INPUT target. The first must stay 1.0;
    // making it .5 would render the entire scene at half resolution.
    const extract=new PostProcess('hd-bloom-mask','hdBloomExtract',
      ['sourceSize','emitters','hero','count'],null,1,null,Texture.NEAREST_SAMPLINGMODE,engine);
    const x=new PostProcess('hd-bloom-x','hdBloomBlur',['delta'],null,.5,null,Texture.BILINEAR_SAMPLINGMODE,engine);
    const y=new PostProcess('hd-bloom-y','hdBloomBlur',['delta'],null,.5,null,Texture.BILINEAR_SAMPLINGMODE,engine);
    const merge=new PostProcess('hd-bloom-merge','hdBloomMerge',['weight'],['baseSampler'],.5,null,Texture.BILINEAR_SAMPLINGMODE,engine);
    passes=[extract,x,y,merge];
    for (const pass of passes) { pass.metadata={hd2dOrder:order}; pass.autoClear=false; pass.adaptScaleToCurrentViewport=true; }
    extract.onApply=effect=>{
      effect.setFloat2('sourceSize',extract.width,extract.height);
      effect.setArray4('emitters',emitters); effect.setArray4('hero',hero); effect.setFloat('count',count);
    };
    x.onApply=effect=>effect.setFloat2('delta',(current==='high'?2:1)/x.width,0);
    y.onApply=effect=>effect.setFloat2('delta',0,(current==='high'?2:1)/y.height);
    merge.onApply=effect=>{
      effect.setTextureFromPostProcess('baseSampler',extract);
      effect.setFloat('weight',current==='high'?1.4:.9);
    };
  }
  const api={
    setTier(value) {
      if (disposed) return;
      const next=value==='low'||value==='high'?value:'off';
      if (current===next) return;
      current=next;
      if (next==='off') release();
      else if (!passes) create();
    },
    update() {
      if (!passes || disposed) return;
      if (!attached) {
        if (!passes.every(pass=>pass.isReady())) return;
        for (const pass of passes) camera.attachPostProcess(pass);
        attached=true;
      }
      keepOrder();
      if (renderer.world!==world) api.onWorld();
      camera.getViewMatrix(); camera.getProjectionMatrix();
      const matrix=camera.getTransformationMatrix();
      count=0;
      for (let i=0;i<sources.length && count<MAX_SOURCES;i++) {
        if (bounds(sources[i],matrix,emitters,count*4)) count++;
      }
      const particles = renderer.hd2dParticleBloom;
      if (particles) for (let i = 0; i < particles.count; i++) {
        const at = i * 4, r = particles.rects;
        appendParticle(r[at], r[at + 1], r[at + 2], r[at + 3]);
      }
      hero.fill(-2);
      bounds(renderer.monk?.mesh,matrix,hero,0);
    },
    onWorld() {
      if (!passes || disposed) return;
      sources.length=0;
      for (const mesh of scene.meshes) add(mesh);
      syncWorld();
    },
    dispose() {
      if (disposed) return;
      release(); disposed=true;
      scene.onDisposeObservable.remove(onDispose);
    },
  };
  const onDispose=scene.onDisposeObservable.addOnce(()=>api.dispose());
  api.setTier(tier);
  return api;
}
