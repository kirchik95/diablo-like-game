import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { ink, stoneTexture, flameMaterial } from './scene-art.js';
import { TILES, hasTile, PILLARS, BRAZIERS, SHRINE, EXIT } from './world.js';

export const color = hex => Color3.FromHexString(hex);
export function material(scene, name, hex, glow = 0) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color(hex);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = color(hex).scale(glow);
  return mat;
}
function noise(x, y, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 73.7) * 43758.5453;
  return n - Math.floor(n);
}

export function buildWorld(scene, shadows) {
  const staticMeshes = [];
  const palettes = {
    stone: ['#74727d', '#696973', '#81808a', '#656674', '#74747e', '#78777f'].map((h, i) => material(scene, `limestone-${i}`, h)),
    edge: material(scene, 'carved-dark-stone', '#4b4858'),
    wall: material(scene, 'ancient-masonry', '#696474'),
    cap: material(scene, 'pale-cut-stone', '#8c8791'),
    rock: material(scene, 'foundation-rock', '#292837'),
    bronze: material(scene, 'aged-bronze', '#a0825c'),
    black: material(scene, 'charred-wood', '#242331'),
    foliage: material(scene, 'ashen-grass', '#514351'),
    pink: material(scene, 'ritual-flame', '#ff2877', 2.4),
    cyan: material(scene, 'spirit-flame', '#58ffdc', 2),
    rune: material(scene, 'etched-silver', '#73938f', .3),
    fabric: material(scene, 'faded-banner', '#8d335b'),
  };
  Object.values(palettes).flat().forEach(m => { m.maxSimultaneousLights = 8; });
  const texture = stoneTexture(scene, 'hand-painted-paving');
  palettes.stone.forEach(m => { m.diffuseTexture = texture; });
  const wallTexture = stoneTexture(scene, 'hand-painted-masonry', true);
  for (const m of [palettes.wall, palettes.edge, palettes.cap]) m.diffuseTexture = wallTexture;
  const flames = { pink: flameMaterial(scene, 'painted-pink-flame'), cyan: flameMaterial(scene, 'painted-cyan-flame', true) };

  function box(name, x, y, z, w, h, d, mat, rotation = 0) {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); mesh.rotation.y = rotation; mesh.material = mat;
    mesh.isPickable = false; mesh.receiveShadows = true; staticMeshes.push(mesh);
    return mesh;
  }
  function cylinder(name, x, y, z, top, bottom, h, mat, tessellation = 8) {
    const mesh = MeshBuilder.CreateCylinder(name, { diameterTop: top, diameterBottom: bottom, height: h, tessellation }, scene);
    mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false; mesh.receiveShadows = true; staticMeshes.push(mesh);
    return mesh;
  }
  function ring(name, x, y, z, diameter, thickness, mat) {
    const mesh = MeshBuilder.CreateTorus(name, { diameter, thickness, tessellation: 64 }, scene);
    mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false;
    return mesh;
  }

  for (const { x, y } of TILES) {
    const n = noise(x, y);
    box('paving', x, -.09 - n * .012, y, .977, .17, .977, palettes.stone[Math.floor(n * 6)], Math.floor(noise(x, y, 5) * 4) * Math.PI / 2);
    if (!hasTile(x + 1, y) || !hasTile(x - 1, y) || !hasTile(x, y + 1) || !hasTile(x, y - 1)) {
      box('foundation', x, -.6, y, 1, .95, 1, palettes.edge);
      const drop = 1.1 + noise(x, y, 3) * 1.7;
      const rock = cylinder('fractured-basalt', x, -1.15 - drop / 2, y, 1.2, .6, drop, palettes.rock, 5);
      rock.rotation.y = n * 6;
      if (!hasTile(x, y + 1)) box('rim', x, -.02, y + .44, 1, .18, .11, palettes.cap);
      if (!hasTile(x + 1, y)) box('rim', x + .44, -.02, y, .11, .18, 1, palettes.cap);
    }
    if (n > .86 && Math.abs(x) > 2 && y < 4) {
      for (let j = 0; j < 3; j++) {
        box('rubble', x + noise(x, j) * .7 - .35, .04, y + noise(y, j) * .7 - .35, .12 + n * .08, .07, .08 + j * .04, palettes.edge, n * 5 + j);
      }
    }
  }

  // Broken rear wall: staggered blocks and missing courses leave sightlines open.
  for (let x = -5; x <= 5; x++) {
    if (x >= 1 && x <= 3) continue;
    const courses = x < -2 ? 4 : x > 3 ? 3 : 2;
    for (let row = 0; row < courses; row++) {
      const bx = x + (row % 2 ? .12 : 0);
      box('wall-block', bx, row * .43 + .2, -4.43, .95, .41, .45, row === courses - 1 ? palettes.cap : palettes.wall);
    }
  }
  for (let y = -4; y < 2; y++) {
    if (y === -1 || y === 0) continue;
    for (let row = 0; row < (y < -1 ? 3 : 1); row++) box('side-wall', -5.43, .21 + row * .43, y, .44, .41, .96, palettes.wall);
  }

  for (const p of PILLARS) {
    const x = p.x, z = p.y, h = p.height;
    box('column-plinth', x, .1, z, .93, .21, .93, palettes.edge);
    box('column-foot', x, .28, z, .77, .15, .77, palettes.cap);
    cylinder('column-base', x, .44, z, .63, .75, .21, palettes.wall);
    for (let k = 0; k < Math.ceil((h - .7) / .48); k++) {
      cylinder('column-drum', x, .67 + k * .48, z, .51, .57, .47, k % 3 === 1 ? palettes.wall : palettes.cap);
    }
    cylinder('capital', x, h, z, .85, .61, .28, palettes.cap);
    box('capital-abacus', x, h + .17, z, .88, .15, .88, palettes.edge, .02);
    if (h > 3) {
      const banner = box('prayer-banner', x + .34, h - .85, z + .12, .035, 1.12, .41, palettes.fabric);
      banner.rotation.z = -.07;
      box('banner-trim', x + .36, h - 1.37, z + .12, .04, .07, .42, palettes.bronze);
    }
  }

  // Worn ritual mosaic at the heart of the courtyard.
  for (const r of [1.85, 2.12, 2.23]) ring('mosaic-ring', 0, .015, -.4, r * 2, .018, palettes.rune);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    box('mosaic-mark', Math.cos(a) * 2, .013, -.4 + Math.sin(a) * 2, .06, .012, .15, palettes.rune, -a);
  }
  const inlay = box('central-diamond', 0, .009, -.4, 1.6, .01, 1.6, palettes.edge, Math.PI / 4);
  staticMeshes.splice(staticMeshes.indexOf(inlay), 1);
  ring('central-seal', 0, .018, -.4, 1.3, .012, palettes.bronze);

  // Crumbling stairs and a luminous threshold suggest the next connected zone.
  for (let i = 0; i < 5; i++) box('gate-step', 2, .06 + i * .035, -9.25 - i * .22, 2.8, .12, .25, palettes.stone[2]);
  box('gate-lintel', 2, 3.45, -9, 4.25, .35, .66, palettes.cap);
  box('gate-keystone', 2, 3.38, -8.88, .55, .65, .86, palettes.edge, .1);
  const gate = MeshBuilder.CreatePlane('spirit-gate', { width: 2.65, height: 3.1 }, scene);
  gate.position.set(EXIT.x, 1.5, EXIT.y - .13);
  gate.material = material(scene, 'threshold-light', '#4aa9bb', .7);
  gate.material.alpha = .13; gate.material.backFaceCulling = false; gate.isPickable = false;
  const gateRing = ring('threshold-seal', EXIT.x, .04, EXIT.y, 1.35, .028, palettes.cyan);

  cylinder('shrine-base', SHRINE.x, .14, SHRINE.y, 1.3, 1.6, .3, palettes.edge);
  cylinder('shrine-rim', SHRINE.x, .33, SHRINE.y, .98, 1.25, .13, palettes.cap);
  const shrineRing = ring('shrine-water', SHRINE.x, .42, SHRINE.y, .8, .025, palettes.cyan);
  const shrine = MeshBuilder.CreatePolyhedron('heart-of-shrine', { type: 1, size: .24 }, scene);
  shrine.position.set(SHRINE.x, 1.1, SHRINE.y); shrine.scaling.y = 1.65; shrine.material = palettes.cyan; shrine.isPickable = false;
  const shrineLight = new PointLight('shrine-light', new Vector3(SHRINE.x, 1.6, SHRINE.y), scene);
  shrineLight.diffuse = color('#57dbce'); shrineLight.intensity = 2; shrineLight.range = 4;

  const fires = [];
  for (let i = 0; i < BRAZIERS.length; i++) {
    const b = BRAZIERS[i];
    cylinder('brazier-foot', b.x, .15, b.y, .36, .55, .3, palettes.edge);
    cylinder('brazier-stem', b.x, .55, b.y, .13, .25, .6, palettes.bronze);
    cylinder('brazier-bowl', b.x, .87, b.y, .6, .25, .23, palettes.bronze);
    const fire = MeshBuilder.CreatePlane('painted-flame', { width: .72, height: 1.02 }, scene);
    fire.position.set(b.x, 1.35, b.y); fire.billboardMode = Mesh.BILLBOARDMODE_ALL;
    fire.material = flames[b.color].material; fire.isPickable = false;
    const light = new PointLight(`brazier-light-${i}`, new Vector3(b.x, 1.6, b.y), scene);
    light.diffuse = color(b.color === 'pink' ? '#ff3388' : '#37efdd'); light.intensity = 3.6; light.range = 6;
    fires.push({ fire, light, x: b.x, y: b.y, color: b.color });
  }

  // Dry plants, carved tablets and splintered beams add a lived-in scale.
  for (const [x, y] of [[-4.8, 2.7], [4.8, 2.6], [-4.8, -3.6], [-8.7, -.4], [3.6, -9.8], [-1.8, 8.8]]) {
    for (let k = 0; k < 5; k++) {
      const reed = cylinder('dead-reed', x + noise(k, x) * .3, .23, y + noise(k, y) * .3, .015, .04, .4 + noise(k, x, 2) * .4, palettes.foliage, 3);
      reed.rotation.z = (noise(k, y, 2) - .5) * .6;
    }
  }
  box('fallen-monument', 4.8, .2, .5, .45, .4, 1.2, palettes.cap, .3);
  box('fallen-monument', -4.6, .17, 1.1, .4, .3, .9, palettes.cap, -.6);
  for (let i = 0; i < 7; i++) {
    box('offering', -8.6 + (i % 3) * .15, .44, -1.6 + Math.floor(i / 3) * .13, .04, .23 + noise(i, 2) * .15, .04, palettes.bronze);
  }

  // Distant silhouettes sit below the playable rock shelf, beyond its boundary.
  for (const [x, z, h] of [[-10, 5, 5], [-13, -5, 7], [8, -9, 6], [10, 1, 4], [-6, -10, 6]]) {
    cylinder('distant-spire', x, -3.2, z, .65, 1.3, h, palettes.rock, 6);
    box('distant-cap', x, -3.2 + h / 2, z, 1.6, .4, 1.6, palettes.edge);
  }

  // Merge fixed geometry per material, so scenery does not cost one draw per stone.
  const groups = new Map();
  for (const m of staticMeshes) {
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(m);
  }
  for (const meshes of groups.values()) {
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (merged) { merged.receiveShadows = true; merged.isPickable = false; ink(merged, .012); shadows.addShadowCaster(merged); merged.freezeWorldMatrix(); }
  }
  return { palettes, fires, flames, shrine, shrineRing, shrineLight, gate, gateRing };
}
