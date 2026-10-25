// Night atmosphere. The stage-0 grade is reused; the ground owns sky/haze and
// one additive mesh carries all moon shafts. No sprite texture or picking is changed.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { ZoneGrade } from '../zone-grade.js';
import { getOverworldZone } from '../overworld.js';

export const id = 'atmos';
export const order = 60;

// Haze belongs to the ground only, so near actor silhouettes retain their contrast.
const HAZE = {
  camp: [.058, .085, .11, .16], road: [.043, .082, .115, .20],
  courtyard: [.075, .075, .085, .15], cemetery: [.035, .085, .115, .24],
  orchard: [.075, .10, .071, .17],
};

function shafts(scene, world) {
  const positions = [], uvs = [], indices = [];
  for (const zone of world?.zones ?? (world ? [world] : [])) {
    let count = 0;
    for (const prop of zone.setDressing ?? []) {
      if (zone.id !== 'orchard' && zone.id !== 'courtyard') continue;
      if (!/^(olive-tree-|pergola-|arch-gate)/.test(prop.kind ?? '') || count++ >= 8) continue;
      const at = prop.contact ?? prop.collider ?? prop;
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      const base = positions.length / 3, width = 3.6, height = 5.8;
      // Same fixed isometric billboard basis as the sprites. The geometry never moves.
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const right = (u - .5) * width, up = v * height;
        positions.push(at.x - right * Math.SQRT1_2 - up * .35355339,
          .06 + up * .8660254, at.y + right * Math.SQRT1_2 - up * .35355339);
        uvs.push(u, v);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  if (!indices.length) return null;
  const mesh = new Mesh('hd-atmos-shafts', scene), data = new VertexData();
  data.positions = positions; data.uvs = uvs; data.indices = indices; data.applyToMesh(mesh);
  const material = new ShaderMaterial('hd-atmos-shafts', scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; attribute vec2 uv;
      uniform mat4 worldViewProjection; varying vec2 vUV;
      void main(){ vUV=uv; gl_Position=worldViewProjection*vec4(position,1.0); }`,
    fragmentSource: `precision highp float;
      varying vec2 vUV; uniform float motion;
      void main(){
        vec2 p=floor(vUV*vec2(96.0,155.0))/vec2(96.0,155.0);
        float centre=.38+p.y*.24;
        float spread=.065+(1.0-p.y)*.22;
        float band=floor(max(0.0,1.0-abs(p.x-centre)/spread)*6.0)/6.0;
        float gate=smoothstep(0.0,.16,p.y)*(1.0-smoothstep(.70,1.0,p.y));
        float slit=.65+.35*step(.38,fract(p.x*13.0+p.y*2.0));
        float alpha=band*gate*slit*(.048+motion*.009);
        gl_FragColor=vec4(.43,.84,.80,alpha);
      }`,
  }, {attributes:['position','uv'], uniforms:['worldViewProjection','motion'], needAlphaBlending:true});
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true; material.backFaceCulling = false;
  mesh.material = material; mesh.isPickable = false; mesh.renderingGroupId = 1;
  mesh.freezeWorldMatrix();
  return { mesh, material, dispose(){ mesh.dispose(); material.dispose(); } };
}

export function install(ctx) {
  const { scene, camera } = ctx;
  let renderer = ctx.renderer, tier = 'off', world = null, ground = null, rays = null;
  let disposed = false, fallback = null, activeGrade = null;
  const focus = new Vector4(), haze = new Vector4();
  const originalClear = scene.clearColor.clone(), nightClear = new Color4(.028,.041,.075,1);
  function restore() {
    ground?.setFloat('hdAtmos', 0);
    rays?.dispose(); rays = null;
    activeGrade?.setAtmosphere('off'); activeGrade = null;
    fallback?.dispose(); fallback = null;
    scene.clearColor.copyFrom(originalClear);
  }
  function bindWorld() {
    ground?.setFloat('hdAtmos', 0);
    rays?.dispose(); rays = null;
    world = renderer.world;
    ground = world?.landscape?.groundMaterial ?? null;
    if (tier !== 'off') rays = shafts(scene, world?.data);
  }
  function setTier(value) {
    if (disposed) return;
    const next = value === 'high' || value === 'low' ? value : 'off';
    if (next === tier) return;
    const wasOff = tier === 'off'; tier = next;
    if (tier === 'off') { restore(); return; }
    if (wasOff) bindWorld();
    scene.clearColor.copyFrom(nightClear);
  }
  function update(dt, time) {
    if (disposed || tier === 'off') return;
    if (world !== renderer.world) bindWorld();
    const game = renderer.game, data = world?.data;
    const zone = data?.zones && game?.player ? getOverworldZone(game.player.x, game.player.y).id : data?.id;
    const ink = HAZE[zone] ?? HAZE.road;
    const target = camera.target;
    focus.set((target.z-target.x)*Math.SQRT1_2,(target.x+target.z)*.35355339,18,ink[3]);
    haze.set(ink[0],ink[1],ink[2],0);
    const animated = tier === 'high' && !renderer.reducedMotion;
    if (ground) {
      ground.setFloat('hdAtmos', animated ? 2 : 1);
      ground.setFloat('hdTime', animated ? time : 0);
      ground.setVector4('hdFocus', focus); ground.setVector4('hdHaze', haze);
    }
    rays?.material.setFloat('motion', animated ? Math.sin(Math.floor(time*6)/6*.45) : 0);
    // A disabled stage-0 grade must not prevent the explicitly enabled HD grade.
    const shared = renderer.polish?.options?.zoneGrade !== false ? renderer.polish?.grade : null;
    if (!shared && !fallback) fallback = new ZoneGrade(camera);
    const grade = shared ?? fallback;
    if (grade !== activeGrade) {
      activeGrade?.setAtmosphere('off'); activeGrade = grade;
      if (shared && fallback) { fallback.dispose(); fallback = null; }
    }
    const changed = grade && grade.atmosTier !== tier;
    grade?.setAtmosphere(tier);
    if (grade && (!shared || changed)) grade.update(zone in HAZE ? zone : 'road', dt);
  }
  const api = { setTier, update,
    onWorld(next) { if (disposed) return; renderer = next ?? renderer; if (tier !== 'off') bindWorld(); },
    dispose() { if (disposed) return; restore(); disposed = true; },
  };
  setTier(ctx.tier);
  return api;
}
