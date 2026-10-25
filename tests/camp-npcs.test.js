import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Material, Texture, VertexBuffer } from '@babylonjs/core';
import { CAMP_NPC_SPOTS } from '../src/camp-layout.js';
import { campNpcPlacements, campNpcFrame, writeCampNpcUvs } from '../src/camp-npcs.js';
import { createCampNpcs, loadPixelAssets, buildPixelWorld, createSprite } from '../src/pixel-scene.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable } from '../src/world.js';
import { readPng } from './helpers/png.js';
import manifest from '../assets/game/pixel-v18/camp-npcs/manifest.json' with { type: 'json' };

const atlas = manifest.campNpcs;

test('three immutable render-only camp spots reserve their core inside existing blockers', () => {
  assert.equal(CAMP_NPC_SPOTS.length, 3);
  assert.equal(new Set(CAMP_NPC_SPOTS.map(p => p.id)).size, 3);
  assert.ok(Object.isFrozen(CAMP_NPC_SPOTS));
  assert.throws(() => { CAMP_NPC_SPOTS[0].x = 99; }, TypeError);
  for (const npc of CAMP_NPC_SPOTS) {
    assert.ok(LOCATIONS.camp.setDressing.some(p => p.id === npc.blocker && p.collider), npc.id);
    // The reserved core is already unreachable; actual feet are checked below.
    for (let y = -npc.radius; y <= npc.radius; y += .04) for (let x = -npc.radius; x <= npc.radius; x += .04) {
      if (Math.hypot(x, y) <= npc.radius) assert.equal(isWalkable(npc.x + x, npc.y + y, .23, LOCATIONS.camp), false, npc.id);
    }
    assert.equal('npcs' in LOCATIONS.camp, false, 'NPC metadata is not copied into simulation world state');
  }
  assert.deepEqual(campNpcPlacements({ x: 6, y: -9 }).map(p => [p.x, p.y]), CAMP_NPC_SPOTS.map(p => [p.x + 6, p.y - 9]));
});

test('every opaque boot pixel stays above already blocked ground, including atlas flips', () => {
  const png = readPng(new URL('../assets/game/pixel-v18/camp-npcs/camp-npcs.png', import.meta.url));
  const boots = { pilgrim: [[25,78,41,84],[55,78,71,84]], wanderer: [[34,79,48,84],[52,79,68,84]], sentry: [[33,80,48,84],[51,80,64,84]] };
  for (const npc of CAMP_NPC_SPOTS) for (const frame of atlas.clips[npc.kind].frames) {
    for (const [left, top, right, bottom] of boots[npc.kind]) for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      if (!png.alpha(frame % atlas.columns * atlas.cell + x, Math.floor(frame / atlas.columns) * atlas.cell + y)) continue;
      // All pixel corners, not just the centre, reserve the visible sole.
      for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
      const u = ((npc.flip ? atlas.cell - x - cx : x + cx) - atlas.anchor[0]) / 32;
      const v = (y + cy - atlas.anchor[1]) / 32;
      const ground = { x: npc.x + (2 * v - u) * Math.SQRT1_2, y: npc.y + (2 * v + u) * Math.SQRT1_2 };
      assert.equal(isWalkable(ground.x, ground.y, .23, LOCATIONS.camp), false,
        `${npc.id}: rendered boot ${x},${y} projects onto walkable ${ground.x},${ground.y}`);
      }
    }
  }
});

test('render clock idles loop independently, ignore invalid time, and hold their rest pose with reduced motion', () => {
  const placements = campNpcPlacements();
  assert.equal(new Set(placements.map(p => p.phase)).size, placements.length);
  for (const npc of placements) {
    const clip = atlas.clips[npc.kind], cycle = clip.frames.length * clip.frameDurationMs / 1000;
    assert.ok(clip.frames.length >= 4 && clip.frames.length <= 6);
    for (const t of [0, .14, .8, 19.6, 86400]) {
      const frame = campNpcFrame(atlas, npc, t);
      assert.ok(clip.frames.includes(frame));
      assert.equal(frame, campNpcFrame(atlas, npc, t + cycle * 17));
      assert.equal(campNpcFrame(atlas, npc, t, true), clip.frames[0]);
    }
    for (const t of [NaN, Infinity, -Infinity, -1]) assert.equal(campNpcFrame(atlas, npc, t), campNpcFrame(atlas, npc, 0));
  }
  assert.ok(new Set(placements.map(p => atlas.clips[p.kind].frames.indexOf(campNpcFrame(atlas, p, 0)))).size > 1);
});

test('batch UVs use each independent atlas cell and mirror only within that cell', () => {
  for (const flip of [false, true]) for (const frame of [0, 4, 11, 12]) {
    const uvs = new Float32Array(24).fill(-1);
    writeCampNpcUvs(uvs, 1, atlas, frame, flip);
    assert.ok([...uvs.slice(0, 8), ...uvs.slice(16)].every(n => n === -1));
    const xs = [uvs[8], uvs[10], uvs[12], uvs[14]], ys = [uvs[9], uvs[11], uvs[13], uvs[15]];
    assert.ok(Math.abs(Math.min(...xs) - (frame % atlas.columns) / atlas.columns) < 1e-7);
    assert.ok(Math.abs(Math.max(...ys) - (1 - Math.floor(frame / atlas.columns) / atlas.rows)) < 1e-7);
    assert.equal(xs[0] > xs[1], flip);
  }
});

async function harness(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const camera = new ArcRotateCamera('npc-test', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -14, orthoRight: 14, orthoTop: 9, orthoBottom: -9 });
  camera.getViewMatrix(true);
  const assets = loadPixelAssets(scene); await assets.ready;
  return { engine, scene, camera, assets };
}

test('NPC bodies and shadows take exactly two shared meshes/materials, write depth, and never participate in picking', async t => {
  const { scene, camera, assets } = await harness(t);
  const counts = ['meshes', 'materials', 'textures'].map(k => scene[k].length);
  const batch = createCampNpcs(scene, assets.campNpcs);
  assert.deepEqual(['meshes', 'materials', 'textures'].map(k => scene[k].length - counts[['meshes', 'materials', 'textures'].indexOf(k)]), [2, 2, 0]);
  assert.equal(batch.body.getTotalVertices(), 12);
  assert.equal(batch.body.subMeshes.length, 1);
  assert.equal(batch.body.material.transparencyMode, Material.MATERIAL_ALPHATEST);
  assert.equal(batch.body.material.disableDepthWrite, false);
  assert.equal(batch.body.renderingGroupId, 1);
  assert.equal(batch.shadow.renderingGroupId, 0);
  assert.equal(batch.body.isPickable, false); assert.equal(batch.shadow.isPickable, false);
  assert.equal(assets.campNpcs.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
  const vertices = batch.body.getVerticesData(VertexBuffer.PositionKind), forward = camera.getForwardRay().direction;
  for (let i = 0; i < 3; i++) {
    const dots = Array.from({ length: 4 }, (_, j) => Vector3.Dot(Vector3.FromArray(vertices, (i * 4 + j) * 3), forward));
    assert.ok(Math.max(...dots) - Math.min(...dots) < 1e-5, 'each quad has the constant depth of its own anchor');
    const at = batch.placements[i], sprite = createSprite(scene, 'comparison', assets.campNpcs);
    sprite.mesh.position.set(at.x, .025, at.y); sprite.mesh.computeWorldMatrix(true);
    const origin = Vector3.TransformCoordinates(Vector3.Zero(), sprite.mesh.getWorldMatrix());
    assert.ok(Math.abs(dots[0] - Vector3.Dot(origin, forward)) < 1e-5, 'same depth as actors/props at this ground anchor');
    sprite.mesh.dispose(); sprite.material.dispose(); sprite.texture.dispose();
  }
  batch.update(1.8, { propShade: false, lightPools: false });
  assert.equal(batch.shadow.isEnabled(), false); assert.equal(batch.body.isEnabled(), true);
  batch.update(2.4, { propShade: true, lightPools: false }); assert.equal(batch.shadow.isEnabled(), true);
  batch.dispose(); batch.dispose();
  assert.deepEqual(['meshes', 'materials', 'textures'].map(k => scene[k].length), counts);
  assert.ok(scene.textures.includes(assets.campNpcs.texture), 'shared atlas stays owned by asset loader');
});

test('world creates NPCs only for the camp and disposes both batch resources with it', async t => {
  const { scene, assets } = await harness(t);
  for (const id of ['road', 'camp', 'courtyard']) {
    const world = buildPixelWorld(scene, assets, LOCATIONS[id]);
    assert.equal(!!world.campNpcs, id === 'camp');
    if (world.campNpcs) {
      assert.ok(world.meshes.includes(world.campNpcs.body));
      assert.ok(!world.props.some(p => p.mesh === world.campNpcs.body), 'not a hover/fade/target sprite');
    }
    world.dispose();
    assert.ok(!scene.meshes.some(m => m.name.startsWith('camp-npc')));
  }
});

test('published atlas frames have binary body alpha, fixed feet/hips, unique idles and measured envelopes', () => {
  const png = readPng(new URL('../assets/game/pixel-v18/camp-npcs/camp-npcs.png', import.meta.url));
  const metrics = JSON.parse(readFileSync(new URL('../assets/game/pixel-v18/camp-npcs/metrics.json', import.meta.url)));
  assert.deepEqual([png.width, png.height], [atlas.cell * atlas.columns, atlas.cell * atlas.rows]);
  assert.equal(metrics.failed, 0);
  for (const [kind, clip] of Object.entries(atlas.clips)) {
    assert.equal(clip.frames.length, 4);
    const frames = metrics.characters[kind].frames;
    assert.equal(new Set(frames.map(f => f.rgbaHash)).size, 4, kind);
    for (const m of frames) {
      assert.ok(m.heightDelta <= 1 && m.headTopDelta <= 1);
      assert.equal(m.hipDelta, 0); assert.equal(m.footDelta, 0); assert.equal(m.lowerBodyStable, true);
    }
    for (const frame of clip.frames) for (let y = 0; y < atlas.cell; y++) for (let x = 0; x < atlas.cell; x++) {
      assert.ok([0, 255].includes(png.alpha(frame % atlas.columns * atlas.cell + x, Math.floor(frame / atlas.columns) * atlas.cell + y)));
    }
  }
});
