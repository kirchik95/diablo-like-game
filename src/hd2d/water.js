import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Matrix, Vector2, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture.js';

export const id = 'water';
export const order = 20;

// Presentation sites use the existing zone offsets; no tile, collider or body is added.
export function waterSites(data) {
  const sites = [];
  for (const z of data?.zones ?? (data ? [data] : [])) {
    const ox = z.offset?.x ?? 0, oy = z.offset?.y ?? 0;
    const put = (name, x, y, width, depth, style = 0) => sites.push({ id: name, x: ox + x, y: oy + y, width, depth, style });
    if (z.id === 'road') {
      put('road-rain-1', -1.1, .5, 2.7, 1.35);
      put('road-rain-2', 1.8, -3.2, 1.4, .8);
      put('road-rain-3', -.8, 15.3, 2.2, 1.1);
      put('road-rain-4', .9, -19.8, 1.8, .9);
    }
    if (z.id === 'courtyard') {
      if (z.ritual) sites.push({ id: 'ritual-basin', x: z.ritual.x, y: z.ritual.y, width: 2.5, depth: 2.5, style: 1 });
      put('courtyard-rain', 3.5, -5, 2.6, 1.25);
    }
    // Beyond the eastern fence, entirely outside the cemetery walk mask.
    if (z.id === 'cemetery') put('cemetery-ditch', 15.5, -2, 3, 6.2, 2);
  }
  return sites;
}

const vertexSource = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV; varying vec4 vClip;
void main(){vUV=uv;vClip=worldViewProjection*vec4(position,1.0);gl_Position=vClip;}`;

const fragmentSource = `precision highp float;
varying vec2 vUV; varying vec4 vClip;
uniform float tick, style, container, realReflection, opacity;
uniform vec4 grid, atlasRect, crop;
uniform vec2 mirrorSize;
uniform sampler2D fakeSampler, mirrorSampler;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 px=floor(vUV*grid.xy),q=(px+.5)/grid.xy,p=q*2.-1.;
  float edge;
  if(container>.5){
    vec2 source=crop.xy+vec2(q.x,1.-q.y)*crop.zw;
    vec2 auv=atlasRect.xy+vec2(source.x/256.,1.-source.y/256.)*atlasRect.zw;
    vec4 original=texture2D(fakeSampler,auv); vec3 ink=original.rgb;
    if(original.a<.5 || ink.b<ink.r || ink.r>.25 || ink.b>.33)discard;
    if(container<1.5){
      vec2 hole=(source-vec2(128.,201.))/vec2(14.,6.);
      edge=length(hole); if(edge>.96)discard;
    }else{
      // Interior of the dry trough, inside its existing stone lips.
      vec2 s=source-vec2(128.,206.);
      edge=max(abs((s.x+s.y*2.)/30.),abs((s.x-s.y*2.)/48.));
      if(edge>.88)discard;
    }
  }else{
    float jag=(hash(floor(q*vec2(13.,9.)))-.5)*.12;
    edge=length(p*vec2(1.,1.+.08*sin(p.x*9.)))+jag;
    if(edge>.94 || (style>.5&&style<1.5&&edge<.48))discard;
  }
  float band=floor((sin(q.y*26.+tick*.23)+sin(q.x*17.-tick*.16))*1.2);
  vec3 deep=vec3(.065,.12,.15),sky=vec3(.16,.27,.29);
  vec3 water=mix(deep,sky,clamp(.45+band*.14+q.y*.16,0.,1.));
  // A nearest sampled, upside-down nearby prop over the stepped night sky.
  if(container<.5){
    float shift=(mod(px.y,4.)<2.?1.:-1.)/grid.x;
    vec2 fuv=vec2(clamp(q.x+shift,.01,.99),clamp(1.-q.y,.01,.99));
    vec4 reflected=texture2D(fakeSampler,atlasRect.xy+fuv*atlasRect.zw);
    water=mix(water,floor(reflected.rgb*5.)/5.*vec3(.47,.68,.72),reflected.a*.42);
  }
  if(realReflection>.5&&container<.5){
    vec2 screen=vClip.xy/vClip.w*.5+.5;
    screen.x+=mod(px.y+floor(tick/3.),3.)/mirrorSize.x;
    screen=(floor(screen*mirrorSize)+.5)/mirrorSize;
    vec3 reflection=texture2D(mirrorSampler,screen).rgb;
    water=mix(water,floor(reflection*8.)/8.*vec3(.62,.8,.82),.6);
  }
  float wave=mod(floor(length((q-vec2(.36,.64))*grid.xy)*.55)-floor(tick/2.),13.);
  if(wave<1.&&hash(vec2(px.x,floor(tick/8.)))>.35)water+=vec3(.045,.095,.09);
  if(edge>.83&&hash(px)>.67)water=vec3(.27,.39,.36);
  if(mod(px.y+floor(tick/3.),11.)<1.&&hash(vec2(floor(px.x/3.),floor(tick/9.)))>.94)
    water=vec3(.68,.88,.8);
  if(style>.5&&style<1.5)water=mix(water,vec3(.22,.10,.26),.18);
  // Sparse bright whole pixels are available to the host bloom pass.
  if(hash(px+floor(tick/5.))>.998&&edge<.8)water=vec3(1.25,1.1,.7);
  gl_FragColor=vec4(water,opacity);
}`;

export function install(ctx) {
  const { scene, engine, camera } = ctx;
  let renderer = ctx.renderer, tier = 'off', world = null, surfaces = [], fallback = null, mirror = null;
  let reflectionCopies = [], candidates = [], visible = false, reflectionUsed = 0;
  const mirrorSize = { width: 1, height: 1 };
  const viewProjection = Matrix.Identity();
  const frustum = Frustum.GetPlanes(viewProjection);
  const dimensions = new Vector2(1, 1);
  const removePass = () => {
    if (!mirror) return;
    for (const s of surfaces) s.material.setTexture('mirrorSampler', fallback);
    const index = scene.customRenderTargets.indexOf(mirror);
    if (index >= 0) scene.customRenderTargets.splice(index, 1);
  };
  const clearMirror = () => {
    removePass(); mirror?.dispose(); mirror = null;
    for (const copy of reflectionCopies) copy.mesh.dispose();
    reflectionCopies = [];
  };
  const clear = () => {
    clearMirror();
    for (const s of surfaces) { s.mesh.dispose(); s.material.dispose(); }
    surfaces = []; candidates = []; fallback?.dispose(); fallback = null;
  };
  function make(site, sprite = null) {
    const container = site.container ?? 0;
    const mesh = container ? MeshBuilder.CreatePlane(`hd-water-${site.id}`, { width: site.width / 32, height: site.depth / 32 }, scene)
      : MeshBuilder.CreateGround(`hd-water-${site.id}`, { width: site.width, height: site.depth }, scene);
    mesh.isPickable = false;
    mesh.metadata = { hd2d: id };
    // Selective bloom recognizes the existing fx-impact emitter tag. Ripple
    // impacts supply glints; the mesh id remains the stable hd-water site id.
    mesh.name = `hd-water-fx-impact-${site.id}`;
    mesh.renderingGroupId = container ? 1 : 0;
    if (container) {
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.bakeTransformIntoVertices(Matrix.Translation((site.crop[0] + site.width / 2 - 128) / 32,
        (232 - site.crop[1] - site.depth / 2) / 32, 0));
      mesh.position.copyFrom(sprite.mesh.position);
      mesh.scaling.copyFrom(sprite.mesh.scaling);
    } else { mesh.position.set(site.x, .035, site.y); mesh.freezeWorldMatrix(); }
    const material = new ShaderMaterial(`hd-water-ink-${site.id}`, scene, { vertexSource, fragmentSource }, {
      attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'tick', 'style', 'container', 'realReflection', 'opacity', 'grid', 'atlasRect', 'crop', 'mirrorSize'],
      samplers: ['fakeSampler', 'mirrorSampler'], needAlphaTesting: !container, needAlphaBlending: !!container,
    });
    material.backFaceCulling = false;
    material.transparencyMode = container ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST;
    material.zOffset = container ? -2 : 0;
    material.zOffsetUnits = container ? -1 : 0;
    mesh.material = material;
    const nearby = sprite ?? candidates.find(p => Math.hypot(p.mesh.position.x - site.x, p.mesh.position.z - site.y) < 7);
    const atlas = nearby?.atlas, frame = nearby?.frame ?? 0;
    material.setTexture('fakeSampler', atlas?.texture ?? fallback);
    material.setTexture('mirrorSampler', fallback);
    material.setVector4('atlasRect', atlas ? new Vector4(frame % atlas.columns / atlas.columns,
      1 - (Math.floor(frame / atlas.columns) + 1) / atlas.rows, 1 / atlas.columns, 1 / atlas.rows) : new Vector4(0, 0, 1, 1));
    material.setVector4('grid', new Vector4(container ? site.width : Math.ceil(site.width * 32), container ? site.depth : Math.ceil(site.depth * 32), 0, 0));
    material.setVector4('crop', new Vector4(...(site.crop ?? [0, 0, 256, 256])));
    material.setFloat('style', site.style ?? 0); material.setFloat('container', container);
    material.setFloat('realReflection', 0); material.setFloat('tick', 0); material.setFloat('opacity', 1); material.setVector2('mirrorSize', dimensions);
    surfaces.push({ mesh, material, site, sprite, visible: false });
  }
  function build() {
    clear(); world = renderer.world;
    if (tier === 'off') return;
    const sites = waterSites(world?.data);
    const containers = (world?.props ?? []).filter(p => ['well', 'stone-basin'].includes(p.placement?.kind));
    if (!sites.length && !containers.length) return;
    candidates = (world?.props ?? []).filter(p => p.atlas && p.mesh.billboardMode === Mesh.BILLBOARDMODE_ALL && p.placement?.layer !== 'ground');
    fallback = RawTexture.CreateRGBATexture(new Uint8Array([29, 47, 57, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    for (const site of sites) make(site);
    for (const p of containers) {
      const well = p.placement.kind === 'well';
      make({ id: p.placement.id, x: p.mesh.position.x, y: p.mesh.position.z, width: well ? 32 : 44, depth: well ? 18 : 30,
        container: well ? 1 : 2, crop: well ? [112, 192, 32, 18] : [106, 192, 44, 30] }, p);
    }
  }
  function addReflection(sprite) {
    if (!sprite?.mesh || reflectionUsed >= 12 || sprite.mesh.isDisposed() || !sprite.mesh.isEnabled()) return;
    if (Math.hypot(sprite.mesh.position.x - camera.target.x, sprite.mesh.position.z - camera.target.z) > 10) return;
    const copy = reflectionCopies[reflectionUsed];
    if (copy.source !== sprite.mesh) {
      const positions = sprite.mesh.getVerticesData('position');
      if (!positions || positions.length !== 12) return;
      copy.mesh.updateVerticesData('position', positions, false, false);
      copy.mesh.material = sprite.material;
      copy.source = sprite.mesh;
    }
    copy.mesh.setEnabled(true);
    copy.mesh.freezeWorldMatrix(sprite.mesh.computeWorldMatrix());
    mirror.renderList[reflectionUsed++] = copy.mesh;
  }
  function ensureMirror() {
    const width = Math.max(1, Math.floor(engine.getRenderWidth() / 4)), height = Math.max(1, Math.floor(engine.getRenderHeight() / 4));
    if (mirror && (mirrorSize.width !== width || mirrorSize.height !== height)) clearMirror();
    if (!mirror) {
      mirrorSize.width = width; mirrorSize.height = height;
      dimensions.set(width, height);
      mirror = new MirrorTexture('hd-water-reflection', mirrorSize, scene, false, 0, Texture.NEAREST_SAMPLINGMODE, true);
      mirror.mirrorPlane = new Plane(0, -1, 0, .035);
      mirror.clearColor = new Color4(.11, .17, .21, 1);
      mirror.renderParticles = false; mirror.renderSprites = false; mirror.samples = 1;
      mirror.renderList = [];
      // A fixed pool prevents camera selection changes from allocating meshes/submeshes.
      for (let i = 0; i < 12; i++) {
        const mesh = MeshBuilder.CreatePlane('hd-water-reflected-prop', { size: 8, updatable: true }, scene);
        mesh.layerMask = 0; mesh.isPickable = false; mesh.renderingGroupId = 0; mesh.alwaysSelectAsActiveMesh = true;
        mesh.setEnabled(false);
        reflectionCopies.push({ mesh, source: null });
      }
    }
    if (!scene.customRenderTargets.includes(mirror)) scene.customRenderTargets.push(mirror);
    // Borrow source materials; dedicated layer-zero copies never enter the main frame
    // and work even when the live prop is hidden by static instancing. No original state changes.
    reflectionUsed = 0;
    addReflection(renderer.monk);
    for (const p of candidates) { addReflection(p); if (reflectionUsed >= 12) break; }
    for (let i = reflectionUsed; i < reflectionCopies.length; i++) reflectionCopies[i].mesh.setEnabled(false);
    mirror.renderList.length = reflectionUsed;
    for (const s of surfaces) {
      s.material.setTexture('mirrorSampler', mirror);
      s.material.setVector2('mirrorSize', dimensions);
    }
  }
  function update(dt, time) {
    if (tier === 'off') return;
    if (world !== renderer.world) build();
    if (!surfaces.length) return;
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), viewProjection);
    Frustum.GetPlanesToRef(viewProjection, frustum);
    visible = false;
    for (const s of surfaces) {
      s.mesh.computeWorldMatrix();
      s.visible = s.mesh.isInFrustum(frustum);
      s.mesh.setEnabled(s.visible); visible ||= s.visible && !s.site.container;
      if (s.sprite) s.material.setFloat('opacity', (s.sprite.material?.alpha ?? 1) * s.sprite.mesh.visibility);
      if (s.visible) s.material.setFloat('tick', renderer.reducedMotion ? 0 : Math.floor(time * 8));
    }
    if (tier === 'high' && visible) ensureMirror(); else removePass();
    for (const s of surfaces) s.material.setFloat('realReflection', tier === 'high' && visible ? 1 : 0);
  }
  function setTier(next) {
    const value = next === 'high' || next === 'low' ? next : 'off';
    if (value === tier) return;
    tier = value;
    if (tier !== 'high') clearMirror();
    if (tier === 'off') clear(); else if (!surfaces.length) build();
  }
  const api = { setTier, update, onWorld(next = renderer) { renderer = next; if (tier !== 'off') build(); }, dispose: clear };
  setTier(ctx.tier);
  return api;
}
