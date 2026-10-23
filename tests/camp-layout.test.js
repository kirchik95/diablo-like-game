import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { isWalkable, hasTile, clearLine, moveBody, findPath } from '../src/world.js';
import { createAdventure, updateGame, interact } from '../src/game.js';
import { CAMP_LAYOUT, ARTBOARD, fromArtboard, toArtboard, horizonAt, inBackdrop } from '../src/camp-layout.js';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { loadPixelAssets, buildPixelWorld } from '../src/pixel-scene.js';
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import { readPng } from './helpers/png.js';

const key = p => `${p.x},${p.y}`;
const props = () => LOCATIONS.camp.setDressing;
const byId = id => props().find(p => p.id === id);
function walk(world, from, target, radius = .23) {
  const path = findPath(from, target, radius, world);
  assert.ok(path.length, `no route ${key(from)} → ${key(target)}`);
  const body = { ...from, radius };
  for (const point of [...path, target]) {
    for (let i = 0; i < 2000 && Math.hypot(point.x - body.x, point.y - body.y) > 1e-7; i++) {
      const dx = point.x - body.x, dy = point.y - body.y, distance = Math.hypot(dx, dy);
      const step = Math.min(.08, distance);
      moveBody(body, dx / distance * step, dy / distance * step, world);
      assert.ok(isWalkable(body.x, body.y, radius, world));
    }
    assert.ok(Math.hypot(point.x - body.x, point.y - body.y) < 1e-6, `blocked at ${key(point)}`);
  }
  return body;
}
function reach(world, cells, radius) {
  const allowed = new Set(cells.map(key)), start = cells.find(p => key(p) === key(world.spawn));
  assert.ok(start, 'spawn must be a usable cell');
  const queue = [start], seen = new Set([key(start)]);
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const next = { x: queue[i].x + dx, y: queue[i].y + dy };
    if (allowed.has(key(next)) && !seen.has(key(next)) && clearLine(queue[i], next, radius, world)) {
      seen.add(key(next)); queue.push(next);
    }
  }
  return seen.size;
}

test('rectangular obstacles block their long side without blocking space beyond the short side', () => {
  const world = { tiles: [], obstacles: [{ x: 0, y: 0, halfWidth: 2, halfDepth: 1 }] };
  for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) world.tiles.push({ x, y });
  assert.equal(isWalkable(1.9, 0, .23, world), false);
  assert.equal(isWalkable(0, 1.3, .23, world), true);
  assert.equal(isWalkable(2.15, 1.15, .23, world), false, 'round actor overlaps the rectangular corner');
  assert.equal(isWalkable(2.2, 1.2, .23, world), true, 'do not replace rounded corner clearance with a larger box');
  assert.equal(clearLine({ x: -4, y: 0 }, { x: 4, y: 0 }, .13, world), false);
  const body = { x: -4, y: 0, radius: .23 };
  moveBody(body, 8, 0, world);
  assert.ok(body.x <= -2.23 && body.x > -2.36, 'coarse motion cannot tunnel through a tent');
  walk(world, { x: -4, y: 0 }, { x: 4, y: 0 });
});

test('camp exports one immutable deterministic layout used by the campaign and the world', async () => {
  for (const field of ['regions', 'spawn', 'entries', 'exit', 'reward', 'pillars', 'braziers', 'setDressing', 'clearing', 'backdrop']) {
    assert.equal(LOCATIONS.camp[field], CAMP_LAYOUT[field], `${field} must not drift in a second layout`);
  }
  assert.deepEqual(OVERWORLD.zones[0].setDressing, props(), 'the camp area keeps its offset-free placements');
  assert.equal(new Set(props().map(p => p.id)).size, props().length);
  for (const p of props()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.scale > 0, p.id);
    assert.equal(typeof p.flip, 'boolean');
    assert.ok(p.collider || p.contact, `${p.id}: every prop publishes its ground centre`);
  }
  assert.throws(() => { byId('tent-left').collider.x = 999; }, TypeError);
  assert.throws(() => { CAMP_LAYOUT.backdrop.horizon[0][0] = 999; }, TypeError);
  const fresh = await import('../src/camp-layout.js?determinism-check');
  assert.deepEqual(fresh.CAMP_LAYOUT, CAMP_LAYOUT, 'generated rim, groves and fillers are reproducible');
});

test('the artboard mapping keeps the game scale and puts the fire at its traced centre', () => {
  assert.deepEqual(ARTBOARD.origin, [915, 400]);
  assert.equal(ARTBOARD.pixelsPerUnit / 32, 1.1, 'artboard props are drawn at 1.1× the 32 px/u game art');
  for (const [x, y] of [[0, 0], [300, 700], [1512, 0], [756, 426]]) {
    const world = fromArtboard(x, y), back = toArtboard(world.x, world.y);
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9);
  }
  // Ground contacts traced on the Paper artboard (image pixels).
  const traced = { fire: [915, 400], tripod: [988, 395], log: [995, 442], 'tent-right': [1135, 300], 'tent-left': [295, 568],
    carpet: [675, 552], 'pillar-east': [595, 210], 'pillar-west': [350, 272] };
  for (const [id, [x, y]] of Object.entries(traced)) {
    const p = byId(id), c = p.collider ?? p.contact, a = toArtboard(c.x, c.y);
    assert.ok(Math.hypot(a.x - x, a.y - y) < 16, `${id} drifts ${Math.hypot(a.x - x, a.y - y).toFixed(1)} px from the artboard`);
  }
  const spawn = toArtboard(LOCATIONS.camp.spawn.x, LOCATIONS.camp.spawn.y);
  assert.ok(Math.hypot(spawn.x - 740, spawn.y - 428) < 16, 'the hero starts where the artboard monk stands');
  const reward = toArtboard(LOCATIONS.camp.reward.x, LOCATIONS.camp.reward.y);
  assert.ok(reward.x > 545 && reward.x < 800 && reward.y > 490 && reward.y < 620, 'the bead lies on the supply carpet');
});

test('the camp footprint is one connected safe clearing with one road mouth at the shared seam', () => {
  const world = LOCATIONS.camp;
  assert.ok(world.tiles.length > 600, 'the clearing, grass ring, tents and road keep room to move');
  assert.equal(new Set(world.tiles.map(key)).size, world.tiles.length);
  for (const p of world.tiles) {
    assert.ok(p.y >= -29 && p.y >= OVERWORLD.safeArea.minY && p.y <= OVERWORLD.safeArea.maxY, `${key(p)} leaves the safe band`);
    assert.equal(getOverworldZone(p.x, p.y).id, 'camp');
  }
  for (let x = -2; x <= 2; x++) assert.ok(hasTile(x, -29, world), `road mouth cell ${x},-29`);
  assert.deepEqual(world.portals.map(p => [p.id, p.x, p.y, p.target]), [['camp-road', 0, -27, 'road']]);
  for (const radius of [.23, .29]) {
    const usable = world.tiles.filter(p => isWalkable(p.x, p.y, radius, world));
    assert.ok(usable.length > world.tiles.length * .7);
    assert.equal(reach(world, usable, radius), usable.length, 'no disconnected pockets behind scenery');
  }
});

// Blocker extent on the ground: colliders, or the visible core of decor that
// no longer needs collision because it cannot touch the walk mask.
function extent(p) {
  const c = p.collider, f = panorama.footprints[p.kind];
  if (c) return { x: c.x, y: c.y, rx: c.radius ?? c.halfWidth, ry: c.radius ?? c.halfDepth };
  if (p.area) return { ...p.contact, rx: p.area.halfWidth, ry: p.area.halfDepth };
  if (f && f.role !== 'flat') return { ...p.contact, rx: (f.radius ?? f.halfWidth) * p.scale, ry: (f.radius ?? f.halfDepth) * p.scale };
  return null;
}
const gap = (e, x, y) => Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx), Math.max(0, Math.abs(y - e.y) - e.ry));

test('every edge of the walk mask is marked by a visible stone, shrub, tree or camp prop', () => {
  const world = LOCATIONS.camp, cells = new Set(world.tiles.map(key));
  const blockers = props().map(extent).filter(Boolean);
  let edges = 0;
  for (const p of world.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (cells.has(key({ x: p.x + dx, y: p.y + dy })) || p.y + dy < -29) continue;
    const x = p.x + dx * .5, y = p.y + dy * .5;
    assert.ok(blockers.some(e => gap(e, x, y) < 1.15), `invisible wall at ${x},${y}`);
    edges++;
  }
  assert.ok(edges > 100);
  for (const p of props().filter(p => p.id.startsWith('boundary-'))) {
    assert.equal(hasTile(p.collider.x, p.collider.y, world), false, `${p.id}: filler centre moved into the walk mask`);
  }
});

test('stone gathers in masses and wall runs; lone stones are a few rounded boulders', () => {
  const stones = props().filter(p => /^(outcrop-|boulder-)/.test(p.kind)), at = p => p.collider ?? p.contact;
  assert.equal(stones.filter(p => p.kind === 'outcrop-block').length, 0, 'no small cut cubes scattered in the meadow');
  const boulders = stones.filter(p => p.kind === 'boulder-round');
  assert.ok(boulders.length >= 3 && boulders.length <= stones.length * .2, `${boulders.length} lone boulders of ${stones.length} stones`);
  const masses = stones.filter(p => p.kind !== 'boulder-round');
  const grouped = masses.filter(p => stones.some(q => q !== p && Math.hypot(at(p).x - at(q).x, at(p).y - at(q).y) < 3.6));
  assert.ok(grouped.length >= masses.length * .55, `${grouped.length} of ${masses.length} outcrops join a larger mass`);
  assert.ok(stones.some(p => p.kind === 'outcrop-ledge-x') && stones.some(p => p.kind === 'outcrop-crag'), 'irregular ledge and crag silhouettes');
  assert.ok(stones.every(p => p.kind === 'boulder-round' || p.scale >= .8), 'outcrops keep their full block size');
});

test('the north-east horizon is world-fixed, continuous and climbs out of view at both ends', () => {
  const { horizon } = CAMP_LAYOUT.backdrop;
  assert.ok(horizon.every((p, i) => i === 0 || p[0] > horizon[i - 1][0]), 'monotonic screen u');
  // The first and last authored segments are the steep, hidden ends.
  const [first, last] = [horizon[0][0], horizon.at(-1)[0]];
  for (let u = horizon[1][0]; u < horizon.at(-2)[0]; u += .25) assert.ok(Math.abs(horizonAt(horizon, u + .01) - horizonAt(horizon, u)) < .1, `step at ${u}`);
  assert.ok(horizonAt(horizon, first - 1) < horizon[0][1] - 20 && horizonAt(horizon, last + 1) < horizon.at(-1)[1] - 20, 'ends leave the view');
  // Paper artboard rim samples (image pixels) lie on the horizon.
  for (const [ix, iy] of [[1010, 110], [1250, 160], [1430, 245], [1512, 255]]) {
    const p = fromArtboard(ix, iy), u = (p.y - p.x) * Math.SQRT1_2, v = (p.x + p.y) / (2 * Math.SQRT2);
    assert.ok(Math.abs(horizonAt(horizon, u) - v) < .45, `rim at artboard ${ix},${iy}`);
  }
});

test('the mountain backdrop never covers playable ground, its borders or any standing prop', () => {
  const backdrop = CAMP_LAYOUT.backdrop;
  for (const p of OVERWORLD.tiles) assert.equal(inBackdrop(backdrop, p.x, p.y, 1.5), false, `${key(p)} is too close to the drop`);
  for (const p of props()) {
    const c = p.collider ?? p.contact;
    assert.equal(inBackdrop(backdrop, c.x, c.y), false, `${p.id} stands beyond the horizon`);
  }
  const rim = props().filter(p => p.id.startsWith('rim-'));
  assert.ok(rim.length > 10, 'the rim needs trees, shrubs and stones against the mountains');
  for (const p of rim) {
    const c = p.collider ?? p.contact, u = (c.y - c.x) * Math.SQRT1_2, v = (c.x + c.y) / (2 * Math.SQRT2);
    // The west-end grove stands beside the steep end; its crowns cover it.
    if (p.id.startsWith('rim-end-')) assert.ok(Math.abs(u - backdrop.horizon[1][0]) < 1, `${p.id} no longer hides the rim end`);
    else assert.ok(v - horizonAt(backdrop.horizon, u) < 1.5, `${p.id} drifts away from the rim`);
  }
});

test('tall scenery stays out of the hero’s screen column in front of playable ground', () => {
  const tiles = new Set(LOCATIONS.camp.tiles.map(key));
  for (const p of props().filter(p => /^(grove|rim)-/.test(p.id) && /cypress|cliff/.test(p.kind))) {
    const c = p.collider ?? p.contact;
    for (let k = 1; k <= 16; k++) {
      const x = Math.round(c.x - k * Math.SQRT1_2), y = Math.round(c.y - k * Math.SQRT1_2);
      assert.ok(!tiles.has(`${x},${y}`), `${p.id} would hide the hero at ${x},${y}`);
    }
  }
});

async function projection(t) {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('contact-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 5.625, orthoBottom: -5.625 });
  const fetch = t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  fetch.mock.restore();
  const world = buildPixelWorld(scene, assets, LOCATIONS.camp);
  scene.render();
  const pngs = new Map();
  const png = sprite => {
    const url = sprite.atlas === assets.campPanorama ? '../assets/game/pixel-v9/camp-panorama/camp-panorama.png'
      : sprite.atlas === assets.landscape ? '../assets/game/pixel-v4/landscape/landscape.png' : '../assets/game/pixel-v5/camp/camp.png';
    if (!pngs.has(url)) pngs.set(url, readPng(new URL(url, import.meta.url)));
    return pngs.get(url);
  };
  const project = p => Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
  const pixel = (sprite, x, y) => {
    const u = ((sprite.flip ? sprite.atlas.cell - x : x) - sprite.atlas.anchor[0]) / 32, v = (sprite.atlas.anchor[1] - y) / 32;
    // Ground art lies flat: image right is screen right, image up is the far ground direction.
    const local = sprite.placement?.layer === 'ground'
      ? new Vector3(-Math.SQRT1_2 * u - Math.SQRT2 * v, 0, Math.SQRT1_2 * u - Math.SQRT2 * v) : new Vector3(u, v, 0);
    return project(Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true)));
  };
  const opaque = sprite => {
    const points = [], size = sprite.atlas.cell, image = png(sprite), columns = sprite.atlas.columns;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (image.alpha(sprite.frame % columns * size + x, Math.floor(sprite.frame / columns) * size + y)) points.push(pixel(sprite, x + .5, y + .5));
    }
    return points;
  };
  return { assets, world, project, pixel, opaque };
}

test('stone, tree, shrub and camp-prop contacts project onto their ground centres at every scale and flip', async t => {
  const { assets, world, project, pixel } = await projection(t);
  const natural = JSON.parse(readFileSync(new URL('../assets/concepts/camp-plan-01/source/natural-contacts.json', import.meta.url))).frames;
  let checked = 0;
  for (const sprite of world.props.filter(s => s.placement)) {
    const p = sprite.placement, c = p.collider ?? p.contact;
    const contact = sprite.atlas === assets.campPanorama ? panorama.footprints[p.kind].contactCenter
      : sprite.atlas === assets.landscape ? natural[p.kind].contactCenter : null;
    if (!contact) continue;
    const drawn = pixel(sprite, ...contact), centre = project(new Vector3(c.x, p.layer === 'ground' ? 0 : sprite.mesh.position.y - .03, c.y));
    assert.ok(Math.abs(drawn.x - centre.x) < .05, `${p.id}: flipped/scaled contact is sideways from its centre`);
    assert.ok(Math.abs(drawn.y - centre.y) < .85, `${p.id}: the lower anchor was used as the support centre`);
    checked++;
  }
  assert.ok(checked > 200);
});

test('walking into solid props stops at their drawn base, not on a transparent margin', async t => {
  const { world, project, opaque } = await projection(t);
  const solids = world.props.filter(s => s.placement?.collider && !['tent-left', 'tent-right', 'campfire-base', 'supply-cache', 'fallen-log']
    .includes(s.placement.kind));
  assert.ok(solids.length > 40);
  for (const sprite of solids) {
    const p = sprite.placement, c = p.collider, pixels = opaque(sprite), ground = sprite.mesh.position.y - .03;
    // Isolate each obstacle so neighbours or the walk mask cannot stop the body first.
    const floor = { obstacles: [c], tiles: [] };
    for (let x = Math.floor(c.x) - 6; x <= Math.ceil(c.x) + 6; x++) for (let y = Math.floor(c.y) - 6; y <= Math.ceil(c.y) + 6; y++) floor.tiles.push({ x, y });
    for (const [dx, dy] of [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2]]) {
      const body = { x: c.x + 4 * dx, y: c.y + 4 * dy, radius: .23 };
      for (let i = 0; i < 420; i++) moveBody(body, -.01 * dx, -.01 * dy, floor);
      const near = project(new Vector3(body.x - body.radius * dx, ground, body.y - body.radius * dy));
      const distance = Math.min(...pixels.map(q => Math.hypot(q.x - near.x, q.y - near.y)));
      // The tripod is an open A-frame; its kettle hangs between the splayed legs.
      const tolerance = p.kind === 'tripod-kettle' ? 7.5 : 3 * p.scale + 1.5;
      assert.ok(distance <= tolerance, `${p.id}: transparent contact margin ${distance.toFixed(2)} native px`);
    }
  }
});

test('solid camp props use their world collider centres once, while ground art stays traversable', () => {
  const world = LOCATIONS.camp;
  const solids = props().filter(p => p.collider);
  assert.equal(world.obstacles.length, solids.length, 'do not add pillar/fire colliders over the art');
  for (const p of solids) {
    assert.ok(world.obstacles.includes(p.collider), `${p.id}: collider must come from the layout`);
    assert.equal(isWalkable(p.collider.x, p.collider.y, .23, world), false, `${p.id}: visible blocker is traversable`);
  }
  assert.ok(world.obstacles.length < 120, 'distant decor must not lengthen every collision query');
  for (const p of props().filter(p => p.layer === 'ground')) {
    assert.equal(p.collider, undefined);
    if (hasTile(p.contact.x, p.contact.y, world) && p.kind === 'woven-carpet') assert.equal(isWalkable(p.contact.x + 1.5, p.contact.y + 2, .23, world), true);
  }
});

test('both tent registrations match their own measured cloth footprints and exclude ropes', () => {
  const footprints = JSON.parse(readFileSync(new URL('../assets/game/pixel-v5/camp/source/footprints.json', import.meta.url))).tents;
  for (const id of ['tent-left', 'tent-right']) {
    const p = byId(id), source = footprints[id];
    const points = source.polygon.map(([px, py]) => {
      const u = (px - 128) * p.scale, v = (py - 232) * p.scale;
      return { x: p.x + (2 * v - u) / (32 * Math.SQRT2), y: p.y + (2 * v + u) / (32 * Math.SQRT2) };
    });
    for (const [axis, half] of [['x', p.collider.halfWidth], ['y', p.collider.halfDepth]]) {
      const low = Math.min(...points.map(q => q[axis])), high = Math.max(...points.map(q => q[axis]));
      assert.ok(low >= p.collider[axis] - half - 1e-6 && high <= p.collider[axis] + half + 1e-6, `${id}: cloth protrudes beyond collision`);
      assert.ok(2 * half - (high - low) <= .2, `${id}: ropes or atlas padding inflated the collider`);
      assert.ok(Math.abs((low + high) / 2 - p.collider[axis]) < .001, `${id}: collision was placed at the bottom sprite anchor`);
    }
  }
});

for (const kind of ['campfire-base', 'supply-cache', 'fallen-log']) {
  test(`${kind} collision encloses its measured ground contact at the actual scale and flip`, () => {
    const source = JSON.parse(readFileSync(new URL('../assets/game/pixel-v5/camp/source/footprints.json', import.meta.url))).props[kind];
    const placed = props().filter(p => p.kind === kind);
    assert.ok(placed.length);
    for (const p of placed) {
      const points = source.polygon.map(([px, py]) => {
        const u = (px - 128) * p.scale * (p.flip ? -1 : 1), v = (py - 232) * p.scale;
        return { x: p.x + (2 * v - u) / (32 * Math.SQRT2), y: p.y + (2 * v + u) / (32 * Math.SQRT2) };
      });
      const o = p.collider;
      if (o.radius) {
        const radius = Math.max(...points.map(q => Math.hypot(q.x - o.x, q.y - o.y)));
        assert.ok(radius <= o.radius + 1e-6 && o.radius - radius < .05, `${p.id}: the stone ring and collision disagree`);
      } else {
        for (const [axis, half] of [['x', o.halfWidth], ['y', o.halfDepth]]) {
          const low = Math.min(...points.map(q => q[axis])), high = Math.max(...points.map(q => q[axis]));
          assert.ok(low >= o[axis] - half - 1e-6 && high <= o[axis] + half + 1e-6, `${p.id}: solid art exceeds its collider`);
          assert.ok(2 * half - (high - low) <= .1, `${p.id}: collider includes empty atlas padding`);
          assert.ok(Math.abs((low + high) / 2 - o[axis]) < .001, `${p.id}: anchor/scale/flip drifts from the fixed centre`);
        }
      }
    }
  });
}

test('the fire ring keeps its accepted approach, kettle and log beside it', () => {
  const world = LOCATIONS.camp;
  assert.deepEqual([byId('fire').collider.x, byId('fire').collider.y, byId('fire').collider.radius], [-3, -2, 1.4375]);
  assert.equal(isWalkable(-1.5, -2, .23, world), false);
  for (const radius of [.23, .29]) {
    assert.equal(isWalkable(-1, -2, radius, world), true);
    walk(world, world.spawn, { x: -1, y: -2 }, radius);
    assert.ok(clearLine({ x: -1, y: -2 }, { x: 0, y: -1 }, radius, world));
  }
  const fire = byId('fire').collider;
  for (const id of ['tripod', 'log']) {
    const c = byId(id).collider;
    assert.ok(Math.hypot(c.x - fire.x, c.y - fire.y) < 4, `${id} belongs to the fire`);
  }
});

test('the clearing and every tent door, the fire, the carpet and the exit are reachable', () => {
  const world = LOCATIONS.camp;
  const right = byId('tent-right').collider, left = byId('tent-left').collider, rug = byId('carpet');
  const targets = [
    { x: right.x + right.halfWidth + .9, y: right.y }, // door faces +x, toward the fire
    { x: left.x, y: left.y + left.halfDepth + .9 }, // door faces +y, toward the carpet
    { x: -1, y: -2 }, world.reward, { x: rug.contact.x - 1.5, y: rug.contact.y + 2.2 }, world.exit,
  ];
  for (const radius of [.23, .29]) {
    for (let x = 0; x <= 3; x += .5) for (let y = -6; y <= -2; y += .5) {
      assert.ok(isWalkable(x, y, radius, world), `central clearing blocked at ${x},${y}`);
    }
    for (const from of [world.spawn, world.entries.road]) for (const target of targets) walk(world, from, target, radius);
  }
});

test('the central camp prop foundations stay separate after art registration', () => {
  const core = ['fire', 'log', 'tent-left', 'tent-right', 'supplies', 'carpet-crate', 'pillar-east', 'pillar-west'].map(byId);
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) {
    const a = core[i].collider, b = core[j].collider;
    const width = (a.halfWidth ?? a.radius) + (b.halfWidth ?? b.radius);
    const depth = (a.halfDepth ?? a.radius) + (b.halfDepth ?? b.radius);
    assert.ok(Math.abs(a.x - b.x) > width + .05 || Math.abs(a.y - b.y) > depth + .05, `${core[i].id} and ${core[j].id} overlap or touch`);
  }
  // The kettle stands right at the ring, as on the artboard, without touching it.
  const fire = byId('fire').collider, tripod = byId('tripod').collider;
  assert.ok(Math.hypot(fire.x - tripod.x, fire.y - tripod.y) > fire.radius + tripod.radius + .05);
  const rug = byId('carpet');
  for (const id of ['supplies', 'carpet-crate']) {
    const c = byId(id).collider;
    assert.ok(Math.abs(c.x - rug.contact.x) + c.halfWidth <= rug.area.halfWidth && Math.abs(c.y - rug.contact.y) + c.halfDepth <= rug.area.halfDepth,
      `${id} must stand on the carpet`);
  }
});

test('camp paving connects spawn, entry and reward without crossing solid foundations', () => {
  const world = LOCATIONS.camp;
  assert.ok(world.paving.length > 0 && world.paving.length < world.tiles.length / 2);
  for (const p of world.paving) assert.ok(isWalkable(p.x, p.y, Math.SQRT1_2, world));
  const pavedWorld = { ...world, tiles: world.paving };
  for (const radius of [.23, .29]) {
    assert.equal(reach(pavedWorld, world.paving, radius), world.paving.length);
    for (const from of [world.spawn, world.entries.road]) for (const to of [world.reward, world.exit]) walk(pavedWorld, from, to, radius);
  }
});

test('the rebuilt camp keeps seamless round trips, an accessible reward and restart behaviour', async () => {
  const { MONK_RULES } = await import('../src/monk-combat.js');
  const game = createAdventure({ skin: 'deep', hair: 'short', sash: 'teal' });
  const world = game.world, player = game.player, enemies = game.enemies, revision = game.locationRevision;
  assert.deepEqual({ x: game.player.x, y: game.player.y }, CAMP_LAYOUT.spawn);
  const follow = target => {
    const path = findPath(game.player, target, game.player.radius, game.world);
    assert.ok(path.length, `no route to ${key(target)}`);
    for (const p of [...path, target]) for (let i = 0; i < 2000; i++) {
      const dx = p.x - game.player.x, dy = p.y - game.player.y, distance = Math.hypot(dx, dy);
      if (distance < 1e-6) break;
      const before = { x: player.x, y: player.y };
      const dt = Math.min(1 / 120, distance / MONK_RULES.moveSpeed);
      updateGame(game, { moveX: dx / distance, moveY: dy / distance }, dt);
      assert.equal(game.world, world); assert.equal(game.player, player); assert.equal(game.enemies, enemies);
      assert.equal(game.locationRevision, revision);
      assert.ok(Math.hypot(player.x - before.x, player.y - before.y) <= MONK_RULES.moveSpeed * dt + 1e-8, 'crossing the seam must not teleport');
      assert.ok(isWalkable(player.x, player.y, player.radius, world));
      if (i === 1999) assert.fail('route stalled');
    }
    assert.ok(Math.hypot(player.x - target.x, player.y - target.y) < 1e-6);
  };
  follow({ x: 0, y: -27 });
  assert.equal(interact(game), false, 'the former camp portal must not handle E');
  follow({ x: 0, y: -31 });
  assert.equal(game.locationId, 'road');
  follow({ x: 0, y: -28 });
  assert.equal(game.locationId, 'camp');
  assert.deepEqual(game.events.filter(e => e.type === 'area-enter').map(e => [e.from, e.to]), [['camp', 'road'], ['road', 'camp']]);
  follow({ x: CAMP_LAYOUT.reward.x - .5, y: CAMP_LAYOUT.reward.y });
  assert.equal(interact(game), false, 'the rebuilt camp must not bypass the quest');
  game.adventure.quest = 'return'; // Isolate reward access; ritual progression has its own combat tests.
  assert.equal(interact(game), true); assert.equal(game.phase, 'victory');
  const fresh = createAdventure(game.appearance);
  assert.deepEqual({ x: fresh.player.x, y: fresh.player.y }, CAMP_LAYOUT.spawn);
  assert.equal(fresh.player.hp, 100); assert.equal(fresh.adventure.rewardCollected, false);
  assert.notEqual(fresh.player, player); assert.notEqual(fresh.enemies, enemies);
});

test('the camp rebuild preserves complete road and courtyard definitions', () => {
  // Immutable non-camp contract, including geometry and encounters.
  const expected = { road: '749b5aeaa342e9eb6d3c4c8644d001c770670826398720142e3c591f07b11ddd',
    courtyard: '4a200440f4908154d293d242042d7dc91931a65094489f87f5d11e95420d3c8c' };
  for (const [id, hash] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(JSON.stringify(LOCATIONS[id])).digest('hex'), hash);
  }
});
