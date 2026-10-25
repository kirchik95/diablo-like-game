import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3, Matrix, Ray, Plane, Mesh } from '@babylonjs/core';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { LOCATIONS } from '../src/campaign.js';
import { layoutLandscape } from '../src/landscape.js';
import { ROAD_FEATURES, roadPillar } from '../src/road-country.js';
import { buildPixelWorld, pixelAtlases, loadPixelAssets, createSprite } from '../src/pixel-scene.js';
import { Renderer } from '../src/render.js';
import { isWalkable, findPath } from '../src/world.js';
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };

const key = (x, y) => `${x},${y}`;
const ROAD = { top: -41.5, bottom: -99.5 };
const inRoad = p => p.y < ROAD.top && p.y >= ROAD.bottom;
const layout = layoutLandscape(OVERWORLD);
const roadProps = [...layout.border, ...layout.scenery].filter(p => inRoad(p.contact));
const standing = roadProps.filter(p => p.layer !== 'ground');
const walk = new Set(OVERWORLD.tiles.map(p => key(p.x, p.y)));
// Plan gap between a footprint and a walkable cell square.
const cellGap = (fp, x, y) => fp.radius !== undefined
  ? Math.max(0, Math.hypot(Math.max(0, Math.abs(fp.x - x) - .5), Math.max(0, Math.abs(fp.y - y) - .5)) - fp.radius)
  : Math.hypot(Math.max(0, Math.abs(fp.x - x) - .5 - fp.halfWidth), Math.max(0, Math.abs(fp.y - y) - .5 - fp.halfDepth));
const pointGap = (fp, x, y) => fp.radius !== undefined ? Math.max(0, Math.hypot(x - fp.x, y - fp.y) - fp.radius)
  : Math.hypot(Math.max(0, Math.abs(x - fp.x) - fp.halfWidth), Math.max(0, Math.abs(y - fp.y) - fp.halfDepth));

function harness(t) {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene, true, true, Texture.NEAREST_SAMPLINGMODE) }]));
  const camera = new ArcRotateCamera('road-country', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  return { scene, assets, camera };
}

test('the road country is drawn only with the camp art: stone masses, cypresses, bushes, tufts and ruins', () => {
  const frames = new Set(roadProps.map(p => p.frame));
  // The camp art, and the monastery ruins for the ruined gate of the side trail.
  const gate = ['arch-gate', 'fallen-lintel', 'column-drums', 'rubble-pile'];
  assert.ok([...frames].every(frame => panorama.campPanorama.frames.includes(frame) || gate.includes(frame)), [...frames].join());
  assert.ok(gate.every(frame => frames.has(frame) && ruins.monasteryRuins.frames.includes(frame)), 'the ruined gate replaces the v1 arch');
  // The ruins package draws both orientations itself; a mirror would light its shaded faces.
  assert.ok(roadProps.filter(p => ruins.footprints[p.frame]).every(p => !p.flip));
  for (const family of [/^outcrop-(cluster|cliff|crag)/, /^outcrop-(ledge|wall|pair|slab)/, /^cypress-/, /^bush-/, /^boulder-/,
    /^(grass|fern)-tuft/, /^ruin-(pillar|stump|fallen)/]) {
    assert.ok([...frames].some(frame => family.test(frame)), `missing ${family}`);
  }
  // The cemetery's box took the road's east meadow and some of its stone.
  const stone = standing.filter(p => /^(outcrop|boulder)-/.test(p.frame)).length;
  const green = standing.filter(p => /^(cypress|bush)-/.test(p.frame)).length;
  assert.ok(stone > 25 && green > 60, `stone ${stone}, green ${green}`);
  // Stone gathers in masses and runs like the camp's, not as lone pebbles.
  const masses = standing.filter(p => /^outcrop-/.test(p.frame));
  const grouped = masses.filter(p => masses.some(q => q !== p && Math.hypot(q.contact.x - p.contact.x, q.contact.y - p.contact.y) < 4));
  assert.ok(grouped.length / masses.length > .5, `${grouped.length}/${masses.length} outcrops in groups`);
  assert.ok(standing.filter(p => /^ruin-/.test(p.frame)).length >= 6, 'ruined pillars and markers line the road');
  // Every authored feature fits its place beside the unchanged walk mask.
  assert.equal(roadProps.filter(p => p.cluster?.startsWith('road-feature-')).length, ROAD_FEATURES.length);
});

test('standing road props keep their whole drawn base off the walk mask, so movement and encounters are unchanged', () => {
  for (const p of standing) {
    const fp = p.footprint, reach = (fp.radius ?? Math.max(fp.halfWidth, fp.halfDepth)) + 1;
    for (let y = Math.ceil(fp.y - reach); y <= Math.floor(fp.y + reach); y++) for (let x = Math.ceil(fp.x - reach); x <= Math.floor(fp.x + reach); x++) {
      if (walk.has(key(x, y))) assert.ok(cellGap(fp, x, y) >= .04, `${p.frame} at ${fp.x.toFixed(2)},${fp.y.toFixed(2)} reaches cell ${x},${y}`);
    }
  }
  // The road zone keeps the walk mask and colliders of LOCATIONS.road.
  const road = OVERWORLD.zones.find(zone => zone.id === 'road');
  assert.deepEqual(road.tiles, LOCATIONS.road.tiles.map(p => ({ x: p.x, y: p.y - 72 })));
  assert.deepEqual(road.obstacles, LOCATIONS.road.obstacles.map(o => ({ ...o, y: o.y - 72 })));
  assert.equal(OVERWORLD.obstacles.length, OVERWORLD.zones.reduce((sum, zone) => sum + zone.obstacles.length, 0));
});

test('every road edge has a natural blocker beside it, with only short tufted gaps', () => {
  let edges = 0, hedged = 0;
  for (const p of OVERWORLD.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (walk.has(key(p.x + dx, p.y + dy))) continue;
    const x = p.x + dx * .5, y = p.y + dy * .5;
    // The cemetery marks its own edges (cemetery-layout.test.js).
    if (!inRoad({ x, y }) || getOverworldZone(x, y).id !== 'road') continue;
    edges++;
    assert.ok(standing.some(q => pointGap(q.footprint, x, y) < 2.2), `bare edge at ${x},${y}`);
    if (standing.some(q => pointGap(q.footprint, x, y) < 1.2)) hedged++;
  }
  assert.ok(edges > 120);
  // The rhythm varies: most edges are hedged, some open stretches remain.
  assert.ok(hedged / edges > .6 && hedged < edges, `${hedged}/${edges} edges hedged`);
  const gapTufts = roadProps.filter(p => p.layer === 'ground' && OVERWORLD.tiles.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 2)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !walk.has(key(Math.round(p.contact.x) + dx, Math.round(p.contact.y) + dy))));
  assert.ok(gapTufts.length >= 5, 'tufts grow at the open edges');
});

test('every encounter area, landmark and seam stays reachable on the real navigation graph', () => {
  const from = OVERWORLD.spawn;
  const packs = [...new Set(OVERWORLD.encounters.map(e => e.packId))].map(id => OVERWORLD.encounters.find(e => e.packId === id));
  const road = OVERWORLD.zones.find(zone => zone.id === 'road');
  for (const point of [...packs, OVERWORLD.shrine, OVERWORLD.secret, { x: 0, y: -42 }, { x: 0, y: -99 }, ...road.pillars.map(p => ({ x: p.x + 1.4, y: p.y }))]) {
    const path = findPath(from, point, .29, OVERWORLD);
    assert.ok(path.length > 0, `no route to ${point.x},${point.y}`);
    assert.ok(Math.hypot(path.at(-1).x - point.x, path.at(-1).y - point.y) < 1.2);
  }
  for (const e of OVERWORLD.encounters) assert.ok(isWalkable(e.x, e.y, .29, OVERWORLD), e.id);
});

test('the road earth bends inside the walk mask and runs unbroken from the camp seam to the courtyard seam', () => {
  const road = OVERWORLD.zones.find(zone => zone.id === 'road'), paving = new Set(road.paving.map(p => key(p.x, p.y)));
  for (const p of road.paving) assert.ok(walk.has(key(p.x, p.y)) && isWalkable(p.x, p.y, Math.SQRT1_2, road));
  const seen = new Set([key(0, -42)]), queue = [{ x: 0, y: -42 }];
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const next = { x: queue[i].x + dx, y: queue[i].y + dy };
    if (paving.has(key(next.x, next.y)) && !seen.has(key(next.x, next.y))) { seen.add(key(next.x, next.y)); queue.push(next); }
  }
  for (const target of [[0, -99], [OVERWORLD.shrine.x, OVERWORLD.shrine.y], [OVERWORLD.secret.x, OVERWORLD.secret.y]]) {
    assert.ok([...seen].some(id => { const [x, y] = id.split(',').map(Number); return Math.hypot(x - target[0], y - target[1]) < 1.5; }), `${target}`);
  }
  // Not one straight strip: the centre of the worn earth moves across rows.
  const centres = new Set();
  for (let y = -94; y <= -47; y++) {
    const xs = road.paving.filter(p => p.y === y && Math.abs(p.x) < 4).map(p => p.x);
    if (xs.length) centres.add((Math.min(...xs) + Math.max(...xs)) / 2);
  }
  assert.ok(centres.size >= 3);
});

test('the camp meadow and packed earth cover the road and fade out only at the courtyard seam', t => {
  const { scene, assets } = harness(t);
  for (const [world, enabled, seam] of [[OVERWORLD, true, -99.5], [LOCATIONS.road, true, -1e4], [LOCATIONS.courtyard, false, -1e4]]) {
    const built = buildPixelWorld(scene, assets, world), ground = built.landscape.groundMaterial;
    assert.deepEqual(ground.metadata.wanderer, { enabled, seam, below: enabled && world.zones ? 4.9 : 1, above: enabled && world.zones ? 4.5 : 1 });
    for (const name of ['campGrass', 'campEarth']) assert.ok(ground.hasTexture(assets[name].texture));
    built.dispose();
  }
  // The meadow is unbroken like the camp's: bare earth lies on the worn road and the trodden landmarks only.
  const map = layout.surfaceMap, road = OVERWORLD.zones.find(zone => zone.id === 'road');
  const soil = (x, y) => map.data[(Math.floor((y - map.origin.y) * 8) * map.width + Math.floor((x - map.origin.x) * 8)) * 4 + 1] / 255;
  const paving = road.paving.map(p => key(p.x, p.y)), landmarks = [...road.pillars, ...road.braziers, road.shrine, road.secret];
  const meadow = road.tiles.filter(p => p.y > -94 && !paving.some(id => { const [x, y] = id.split(',').map(Number); return Math.hypot(x - p.x, y - p.y) < 2.5; })
    && landmarks.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 2.5));
  assert.ok(meadow.length > 60);
  assert.ok(meadow.filter(p => soil(p.x, p.y) > .5).length / meadow.length < .05, 'no bare soil patches in the road meadow');
  for (const p of [...road.pillars, ...road.braziers, road.shrine, road.secret]) assert.ok(soil(p.x, p.y) > .5, `trodden earth at ${p.x},${p.y}`);
});

test('road pillars draw the camp ruined pillar with its plinth on the unchanged collider', t => {
  const { scene, assets, camera } = harness(t), built = buildPixelWorld(scene, assets, OVERWORLD);
  scene.render();
  const road = OVERWORLD.zones.find(zone => zone.id === 'road');
  const columns = built.columns.filter(sprite => sprite.atlas === assets.campPanorama && sprite.mesh.name.startsWith('column-'));
  assert.equal(columns.length, road.pillars.length);
  const record = panorama.footprints['ruin-pillar'];
  for (const [i, pillar] of road.pillars.entries()) {
    const sprite = columns[i], art = roadPillar(pillar);
    assert.equal(sprite.atlas.frames[sprite.frame], 'ruin-pillar');
    assert.deepEqual([sprite.mesh.position.x, sprite.mesh.position.z, sprite.mesh.scaling.x], [art.x, art.y, art.scale]);
    const collider = road.obstacles.find(o => o.x === pillar.x && o.y === pillar.y);
    assert.equal(collider.halfSize, Math.SQRT1_2);
    for (const [px, py] of record.polygon) {
      const local = new Vector3(((sprite.flip ? 256 - px : px) - 128) / 32, (232 - py) / 32, 0);
      const world = Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true));
      const p = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
      const ray = Ray.CreateNew(p.x, p.y, 640, 360, Matrix.Identity(), camera.getViewMatrix(), camera.getProjectionMatrix());
      const ground = ray.origin.add(ray.direction.scale(ray.intersectsPlane(new Plane(0, 1, 0, 0))));
      // Plinth corners sit on the collider square's corners (the .03u lift is under one native pixel).
      assert.ok(Math.abs(Math.abs(ground.x - pillar.x) - Math.SQRT1_2) < .06 || Math.abs(ground.x - pillar.x) < .06, `${i}: corner x`);
      assert.ok(Math.abs(Math.abs(ground.z - pillar.y) - Math.SQRT1_2) < .06 || Math.abs(ground.z - pillar.y) < .06, `${i}: corner y`);
      assert.ok(Math.max(Math.abs(ground.x - pillar.x), Math.abs(ground.z - pillar.y)) > Math.SQRT1_2 - .06);
    }
  }
  built.dispose();
});

test('road props share the actors’ depth and fade when they hide the hero; tufts lie on the ground', async t => {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  const camera = new ArcRotateCamera('road-occlusion', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  const world = buildPixelWorld(scene, assets, LOCATIONS.road);
  const monk = createSprite(scene, 'monk', assets.monk);
  const renderer = Object.assign(Object.create(Renderer.prototype), { scene, camera, assets, world, monk, hounds: [], width: 640, height: 360 });
  const country = world.props.filter(sprite => sprite.mesh.name.startsWith('landscape-'));
  const list = [...world.landscape.scenery, ...world.landscape.border];
  let faded = 0;
  for (const sprite of country) {
    const p = list[Number(sprite.mesh.name.split('-').at(-1))];
    if (p.layer === 'ground') {
      assert.equal(sprite.mesh.billboardMode, Mesh.BILLBOARDMODE_NONE);
      assert.equal(sprite.mesh.renderingGroupId, 0);
      assert.ok(isWalkable(p.contact.x, p.contact.y, 0, LOCATIONS.road));
      continue;
    }
    assert.equal(sprite.mesh.renderingGroupId, 1, `${p.frame} must be depth sorted with actors`);
    if (faded >= 6) continue;
    // A reachable spot straight up the screen from the prop, inside its drawing:
    // k world units along (-1,-1)/√2 rise k/2 screen units.
    const height = (232 - (panorama.opaqueBounds[p.frame]?.[1] ?? 0)) * p.scale / 32;
    const candidates = Array.from({ length: Math.floor(height * 4) }, (_, i) => (i + 1) * .5 * Math.SQRT1_2)
      .flatMap(k => [0, -.35, .35, -.7, .7].map(across => ({ x: p.contact.x - k - across, y: p.contact.y - k + across })))
      .filter(q => (Math.SQRT2 * (p.contact.x - q.x)) < height * 1.6 && isWalkable(q.x, q.y, .23, LOCATIONS.road));
    const behind = candidates.find(q => {
      monk.mesh.position.set(q.x, .025, q.y);
      renderer.updateOcclusion({ enemies: [] });
      return sprite.material.alpha === .25;
    });
    if (!behind) continue;
    faded++;
    monk.mesh.position.set(p.contact.x + 3, .025, p.contact.y + 3);
    renderer.updateOcclusion({ enemies: [] });
    assert.equal(sprite.material.alpha, 1, `${p.frame}: restore once the hero is in front`);
  }
  assert.ok(faded >= 2, `only ${faded} road props faded over the hero`);
});

test('the side zones widen the map without moving the road groves', () => {
  // A grove's cluster id holds its lattice point x10; the lattice keeps the phase of the spine's
  // extent (min x -59), so a grove far from the side zones stays where it was.
  assert.ok(layout.extent.minX < -59);
  const lattice = [...layout.border, ...layout.scenery].map(p => /^road-grove-(-?\d+),/.exec(p.cluster ?? '')).filter(Boolean);
  assert.ok(lattice.length > 40);
  for (const [, ix] of lattice) assert.equal(((Number(ix) + 590) % 12 + 12) % 12, 0, ix);
  // Nothing of the road's country stands in a side zone's box.
  assert.ok(roadProps.every(p => !getOverworldZone(p.contact.x, p.contact.y).area));
});

test('the road layout is deterministic and stops at both seams', () => {
  const repeat = layoutLandscape({ ...OVERWORLD, tiles: [...OVERWORLD.tiles].reverse() });
  const pick = l => [...l.border, ...l.scenery].filter(p => inRoad(p.contact)).map(p => [p.frame, p.x, p.y, p.scale, p.flip]);
  assert.deepEqual(pick(repeat), pick(layout));
  for (const p of roadProps) assert.equal(getOverworldZone(p.contact.x, p.contact.y).id, 'road');
  // The camp and the courtyard keep their authored belts.
  assert.ok(!layout.border.some(p => p.contact.y < ROAD.bottom));
  assert.ok(!layout.border.some(p => p.contact.y >= ROAD.top));
});
