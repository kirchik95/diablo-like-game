import test from 'node:test';
import assert from 'node:assert/strict';
import { updateGame } from '../src/game.js';
import { crowdFixture, stressCount } from '../scripts/crowd-fixture.js';
import { Renderer } from '../src/render.js';
import { PresentationState } from '../src/pixel-animation.js';

test('fully awake packs perform no redundant line-of-sight scans', () => {
  for (const count of [20, 40, 60]) {
    const game = crowdFixture(count), obstacles = game.world.obstacles;
    let reads = 0;
    game.world = { ...game.world, get obstacles() { reads++; return obstacles; } };
    for (const enemy of game.enemies) { enemy.state = 'recover'; enemy.timer = 10; }
    updateGame(game, {}, 1 / 120);
    assert.ok(reads <= 2, `${count} awake actors did ${reads} scenery lookups while recovering`);
    assert.equal(game.events.filter(e => e.type === 'alert').length, 0);
  }
});

test('unchanged actor lists reuse renderer views and presentation arrays', () => {
  const game = crowdFixture(60);
  const views = game.enemies.map(body => ({ body, id: body.id, kind: body.kind }));
  const r = Object.assign(Object.create(Renderer.prototype), {
    game, hounds: views, world: { data: game.world }, locationRevision: game.locationRevision,
    createEnemy() { throw new Error('unchanged actors must retain their views'); },
    disposeEnemy() { throw new Error('unchanged actors must retain their views'); },
  });
  const p = new PresentationState(game), poses = p.hounds, bodies = p.bodies;
  for (let i = 0; i < 10; i++) { r.syncLocation(game); p.update(game, 1 / 60); }
  assert.equal(r.hounds, views, 'no replacement view array on a stable frame');
  assert.equal(p.hounds, poses, 'no replacement pose array on a stable frame');
  assert.equal(p.bodies, bodies, 'no replacement identity snapshot on a stable frame');
});

test('actor synchronization keeps identity through reorder, replacement, kind change and removal', () => {
  const game = crowdFixture(20), p = new PresentationState(game), original = p.hounds.slice();
  const old = game.enemies.slice(), views = old.map(body => ({ body, id: body.id, kind: body.kind }));
  const disposed = [];
  const r = Object.assign(Object.create(Renderer.prototype), { game, hounds: views, world: { data: game.world }, locationRevision: game.locationRevision,
    createEnemy(body) { return { body, id: body.id, kind: body.kind }; }, disposeEnemy(view) { disposed.push(view); } });
  game.enemies.reverse(); r.syncLocation(game); p.update(game, 0);
  assert.equal(r.hounds[0], views[19]); assert.equal(p.hounds[0], original[19]);
  game.enemies[0] = { ...game.enemies[0] }; r.syncLocation(game); p.update(game, 0);
  assert.notEqual(p.hounds[0], original[19]); assert.ok(disposed.includes(views[19]));
  const previous = r.hounds[1]; game.enemies[1].kind = 'ritual'; r.syncLocation(game);
  assert.notEqual(r.hounds[1], previous); assert.ok(disposed.includes(previous));
  game.enemies.length = 0; r.syncLocation(game); p.update(game, 0);
  assert.equal(r.hounds.length, 0); assert.equal(p.hounds.length, 0);
});

test('overlay projections reuse Babylon matrices and viewport while matching the original projection', async t => {
  const { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } = await import('@babylonjs/core');
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('project', Math.PI / 4, Math.PI / 3, 30, new Vector3(2, .1, -42), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -12, orthoRight: 12, orthoTop: 5, orthoBottom: -5 });
  scene.updateTransformMatrix(true);
  const r = Object.assign(Object.create(Renderer.prototype), { scene, camera, width: 633, height: 292 });
  const points = Array.from({length: 120}, (_, i) => [i / 7 - 8, i / 11 - 50, i % 3]);
  const expected = points.map(([x,y,h]) => { const v=Vector3.Project(new Vector3(x,h,y), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(r.width,r.height)); return {x:Math.round(v.x),y:Math.round(v.y)}; });
  r.project(0,0);
  let matrices=0, viewports=0;
  const identity=Matrix.Identity, global=camera.viewport.toGlobal;
  t.mock.method(Matrix, 'Identity', (...args) => { matrices++; return identity(...args); });
  t.mock.method(camera.viewport, 'toGlobal', (...args) => { viewports++; return global.apply(camera.viewport,args); });
  assert.deepEqual(points.map(p=>r.project(...p)), expected);
  assert.equal(matrices, 0, 'projection must not allocate an identity matrix per label/ring point');
  assert.equal(viewports, 0, 'projection must reuse its viewport');
  r.width=844; r.height=390; camera.viewport.width=.75;
  const v=Vector3.Project(new Vector3(2,1,-42), identity(), scene.getTransformMatrix(), global.call(camera.viewport,r.width,r.height));
  assert.deepEqual(r.project(2,-42,1),{x:Math.round(v.x),y:Math.round(v.y)});
});

test('separation broad phase avoids distant quadratic pair work on both axes', async () => {
  const { crowdSeparation } = await import('../src/enemy-steering.js');
  for (const vertical of [false, true]) {
    const costs=[];
    for (const count of [60, 240]) {
      let reads=0;
      const bodies=Array.from({length:count},(_,i)=>({id:`s-${i}`,hp:1,kind:'hound',radius:.29,
        get x(){reads++;return vertical ? 0 : i*4-500;},get y(){reads++;return vertical ? i*4-500 : 0;}}));
      const forces=crowdSeparation(bodies);
      assert.ok([...forces.values()].every(f=>f.x===0&&f.y===0));
      costs.push(reads);
    }
    assert.ok(costs[1]<costs[0]*6, `4x actors must stay near linear (${vertical?'vertical':'horizontal'}), coordinate reads: ${costs}`);
  }
});

test('spawning combat sprites scans unrelated submeshes once per material', async t => {
  const { NullEngine, Scene, Texture, MeshBuilder } = await import('@babylonjs/core');
  const { createSprite, createShadow, createPixelBillboard, wraithShotPixels, pixelAtlases, batchMaterials } = await import('../src/pixel-scene.js');
  const engine=new NullEngine(), scene=new Scene(engine);
  t.after(()=>{scene.dispose();engine.dispose();});
  let visits=0;
  for(let i=0;i<50;i++) {
    const mesh=MeshBuilder.CreatePlane(`scenery-${i}`,{},scene);let subs=mesh.subMeshes;
    Object.defineProperty(mesh,'subMeshes',{configurable:true,get(){visits++;return subs;},set(v){subs=v;}});
  }
  const atlas={...pixelAtlases.effects,texture:new Texture(null,scene)};
  for(const spawn of [()=>createSprite(scene,'impact',atlas),()=>createShadow(scene,'shadow'),()=>createPixelBillboard(scene,'shot','shot-wraith',wraithShotPixels)]) {
    visits=0; const view=spawn(), material=view.material;
    assert.equal(material.blockDirtyMechanism,false);
    assert.equal(material.disableLighting,true);
    assert.equal(material.backFaceCulling,false);
    assert.equal(material.useAlphaFromDiffuseTexture,true);
    assert.ok(material.diffuseTexture);
    assert.ok(visits<=200, `material setup revisited ${visits} unrelated submeshes`);
  }
  batchMaterials(scene,()=>{
    const sprite=createSprite(scene,'batched-impact',atlas);
    assert.equal(sprite.material.blockDirtyMechanism,false);
    assert.equal(scene.blockMaterialDirtyMechanism,true);
    assert.equal(sprite.material.transparencyMode,1);
    assert.equal(sprite.material.alphaCutOff,.5);
  });
  assert.equal(scene.blockMaterialDirtyMechanism,false);
});

// Original pair loop is the independent exact-float oracle.
function fraction(key) {
  let value = 2166136261;
  for (const char of String(key)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

function referenceSeparation(enemies) {
  const bodies = enemies.filter(e => e.hp > 0 && e.kind !== 'ritual')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const forces = new Map();
  for (const e of bodies) forces.set(e.id, { x: 0, y: 0 });
  // Accumulate from one snapshot, so earlier movers cannot push later movers twice.
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], reach = a.radius + b.radius + .45;
    let x = a.x - b.x, y = a.y - b.y;
    // Reject distant pairs without changing the normalization or accumulation
    // order of any pair that can actually overlap.
    if (Math.abs(x) > reach || Math.abs(y) > reach) continue;
    const distance = Math.hypot(x, y);
    if (distance >= reach) continue;
    if (distance > 1e-8) { x /= distance; y /= distance; }
    else {
      const angle = fraction(`${a.id}:${b.id}`) * Math.PI * 2;
      x = Math.cos(angle); y = Math.sin(angle);
    }
    const strength = 2 * (1 - distance / reach), fa = forces.get(a.id), fb = forces.get(b.id);
    fa.x += x * strength; fa.y += y * strength;
    fb.x -= x * strength; fb.y -= y * strength;
  }
  for (const force of forces.values()) {
    const length = Math.hypot(force.x, force.y);
    if (length > 1.75) { force.x *= 1.75 / length; force.y *= 1.75 / length; }
  }
  return forces;
}


test('indexed separation is bit-identical to the original pair loop for mixed radii and coincident bodies', async () => {
  const { crowdSeparation } = await import('../src/enemy-steering.js');
  let seed=0x13579bdf;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let trial=0;trial<300;trial++) {
    const bodies=Array.from({length:trial%65},(_,i)=>({id:i%2?`ю-${i}`:i,kind:i%11===0?'ritual':'hound',hp:i%13===0?0:1,
      radius:[0,.01,.29,.62,1.8][i%5],x:i%7?random()*24-12:0,y:i%7?random()*24-12:0}));
    assert.deepEqual(crowdSeparation(bodies),referenceSeparation(bodies),`trial ${trial}`);
  }
  // Exact touching and negative boundary coordinates.
  const edge=[{id:'a',hp:1,radius:.29,x:-1,y:-1},{id:'b',hp:1,radius:.62,x:.36,y:-1}];
  assert.deepEqual(crowdSeparation(edge),referenceSeparation(edge));
});


test('the stress fixture requires both explicit diagnostic flags', () => {
  assert.equal(stressCount('?perf=1&crowd=40'),40);
  for(const query of ['', '?crowd=40','?perf=0&crowd=40','?perf=1&crowd=400','?perf=1&crowd=oops']) assert.equal(stressCount(query),0);
});

test('an awake monster adds at most three single-submesh draws and stable frames add none', async t => {
  const { NullEngine, Scene, Texture }=await import('@babylonjs/core');
  const { pixelAtlases }=await import('../src/pixel-scene.js');
  const engine=new NullEngine(),scene=new Scene(engine);t.after(()=>{scene.dispose();engine.dispose();});
  const game=crowdFixture(60), assets={};
  for(const kind of ['hound','wraith','beetle','effects']) assets[kind]={...pixelAtlases[kind],texture:new Texture(null,scene)};
  const r=Object.assign(Object.create(Renderer.prototype),{scene,assets,game,locationRevision:game.locationRevision,world:{data:game.world},hounds:[]});
  r.hounds=game.enemies.map(e=>r.createEnemy(e));
  assert.equal(scene.meshes.length,180);
  assert.ok(scene.meshes.every(m=>m.subMeshes.length===1),'no extra passes hidden in actor geometry');
  const resources=[scene.meshes.length,scene.materials.length,scene.textures.length];
  for(let i=0;i<120;i++) r.syncLocation(game);
  assert.deepEqual([scene.meshes.length,scene.materials.length,scene.textures.length],resources);
});
