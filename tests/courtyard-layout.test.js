import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD, getOverworldZone, createOverworld } from '../src/overworld.js';
import { isWalkable, hasTile, clearLine, moveBody, findPath } from '../src/world.js';
import { COURTYARD_LAYOUT, COURTYARD_SEAM, courtyardFootprint } from '../src/courtyard-layout.js';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { loadPixelAssets, buildPixelWorld, createSprite } from '../src/pixel-scene.js';
import { Renderer } from '../src/render.js';
import { readPng } from './helpers/png.js';
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import { createHash } from 'node:crypto';

const key = p => `${p.x},${p.y}`;
const court = () => LOCATIONS.courtyard;
const props = () => COURTYARD_LAYOUT.setDressing;
const byId = id => props().find(p => p.id === id);
const OFFSET = -120;

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

test('the courtyard exports one immutable deterministic layout used by the campaign and the world', async () => {
  for (const field of ['regions', 'spawn', 'entries', 'exit', 'ritual', 'pillars', 'braziers', 'setDressing', 'flagstones']) {
    assert.equal(court()[field], COURTYARD_LAYOUT[field], `${field} must not drift in a second layout`);
  }
  const zone = OVERWORLD.zones.find(z => z.id === 'courtyard');
  assert.equal(zone.setDressing.length, props().length);
  for (const [i, p] of props().entries()) {
    const q = zone.setDressing[i], c = p.collider ?? p.contact, d = q.collider ?? q.contact;
    assert.deepEqual([q.x, q.y, d.x, d.y], [p.x, p.y + OFFSET, c.x, c.y + OFFSET], `${p.id}: the area moves as one`);
  }
  assert.deepEqual(zone.flagstones, COURTYARD_LAYOUT.flagstones.map(([x, y]) => [x, y + OFFSET]));
  assert.equal(new Set(props().map(p => p.id)).size, props().length);
  for (const p of props()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.scale > 0, p.id);
    assert.equal(typeof p.flip, 'boolean');
    assert.ok(p.collider || p.colliders || p.contact, `${p.id}: every prop publishes its ground centre`);
  }
  assert.throws(() => { props()[0].x = 999; }, TypeError);
  const fresh = await import('../src/courtyard-layout.js?determinism-check');
  assert.deepEqual(fresh.COURTYARD_LAYOUT, COURTYARD_LAYOUT, 'walls, fillers and groves are reproducible');
});

test('the gameplay anchors keep their accepted places', () => {
  const world = court();
  assert.deepEqual(world.ritual, { x: 0, y: -8.4 });
  assert.deepEqual(world.spawn, { x: 0, y: 14 });
  assert.deepEqual(world.entries, { road: { x: 0, y: 14 } });
  assert.deepEqual(world.braziers.map(b => [b.x, b.y, b.color]),
    [[2.12, -8.12, 'pink'], [-2.12, -3.88, 'pink'], [-6, 1, 'cyan'], [6, 1, 'cyan']].map(([x, y, color]) => [x * 1.4, y * 1.4, color]));
  // The pink pair flanks the source on screen instead of standing behind it:
  // the same screen depth v, 3u to either side along screen u.
  const screen = p => ({ u: (p.y - p.x) * Math.SQRT1_2, v: (p.x + p.y) / (2 * Math.SQRT2) });
  const source = screen(world.ritual);
  for (const b of world.braziers.filter(b => b.color === 'pink')) {
    const s = screen(b);
    assert.ok(Math.abs(s.v - source.v) < .05 && Math.abs(Math.abs(s.u - source.u) - 4.2) < .05, `brazier ${b.x},${b.y}`);
  }
  assert.deepEqual(world.portals.map(p => [p.id, p.x, p.y, p.target]), [['courtyard-road', 0, 17.5, 'road']]);
  // Brazier colliders fit the drawn pixel-v11 stone foot (footprint radius).
  const foot = ruins.monasteryWorld.footprints['brazier-cyan'].radius;
  for (const b of world.braziers) assert.ok(world.obstacles.some(o => o.x === b.x && o.y === b.y && o.radius === foot));
});

test('the cloister is one connected walk mask with one road mouth at the shared seam', () => {
  const world = court();
  assert.ok(world.tiles.length >= 360, 'the cloister keeps its gameplay size');
  for (const p of world.tiles) {
    assert.ok(p.y <= COURTYARD_SEAM - .5);
    assert.equal(getOverworldZone(p.x, p.y + OFFSET).id, 'courtyard');
  }
  for (let x = -1; x <= 1; x++) assert.ok(hasTile(x, 20, world), `road mouth cell ${x},14`);
  for (const radius of [.23, .29, .63]) {
    const usable = world.tiles.filter(p => isWalkable(p.x, p.y, radius, world));
    assert.ok(usable.length > world.tiles.length * .6, `${radius}: room to move`);
    if (radius < .5) assert.equal(reach(world, usable, radius), usable.length, 'no disconnected pockets behind ruins');
  }
  for (const target of [world.ritual, { x: 0, y: -10.5 }, { x: -7, y: -3 }, { x: 10, y: 7 }]) walk(world, world.spawn, target);
});

test('encounters fit on open flagstones for many seeds and stay reachable', () => {
  for (const seed of [20261023, 1, 7, 12345, 4294967295, 99, 31337]) {
    const world = createOverworld(seed), guards = world.encounters.filter(e => e.zoneId === 'courtyard');
    assert.ok(guards.length >= 8, `${seed}: two packs of at least 4`);
    for (const e of guards) {
      assert.ok(isWalkable(e.x, e.y, e.kind === 'beetle' ? .63 : .54, world), `${seed}: ${e.id} spawns in a wall`);
      assert.ok(findPath(world.zones[2].spawn, e, .29, world).length, `${seed}: ${e.id} is unreachable`);
    }
  }
});

test('the breach in the back wall leads into the orchard; its rubble keeps the old wall face', () => {
  const world = court();
  for (let y = 1; y <= 4; y++) {
    assert.ok(hasTile(-13, y, world), `breach cell -9,${y}`);
    for (const radius of [.23, .29]) assert.ok(isWalkable(-13, y, radius, world), `breach cell -9,${y} at ${radius}`);
  }
  // The back wall keeps two pieces and its broken end; the third piece fell.
  assert.deepEqual(props().filter(p => /^wall-back-\d+$/.test(p.id)).map(p => [p.id, p.kind]),
    [['wall-back-0', 'wall-run-y'], ['wall-back-1', 'wall-window-y'], ['wall-back-2', 'wall-run-y'], ['wall-back-3', 'wall-end-y']]);
  // The rubble closes both jambs and stops at the wall's inner face (x -8.5), so the cloister's
  // free floor is unchanged.
  for (const id of ['breach-rubble', 'breach-rubble-south']) {
    const c = byId(id).collider;
    assert.ok(Math.abs(c.x + c.halfWidth + 12.5) < 1e-9, `${id} reaches x ${c.x + c.halfWidth}`);
  }
  // No courtyard prop stands west of x -9.5: the orchard owns that ground.
  for (const p of props()) {
    const c = p.collider ?? p.contact ?? p.colliders[0];
    assert.ok(c.x >= -13.5, `${p.id} stands in the orchard at ${c.x},${c.y}`);
  }
  // In the world, the courtyard's entry reaches the orchard's.
  const orchard = OVERWORLD.zones.find(z => z.id === 'orchard');
  for (const radius of [.23, .29]) walk(OVERWORLD, OVERWORLD.zones[2].spawn, orchard.entries.courtyard, radius);
});

// Blocker extent on the ground: colliders, or the visible core of decor that
// no longer needs collision because it cannot touch the walk mask.
function extent(p) {
  const c = p.collider;
  if (c) return { x: c.x, y: c.y, rx: c.radius ?? c.halfWidth, ry: c.radius ?? c.halfDepth };
  if (p.colliders) return null;
  const f = courtyardFootprint(p.kind);
  if (!f || f.role === 'flat' || p.layer === 'ground') return null;
  const box = f.shape === 'circle' ? { rx: f.radius, ry: f.radius }
    : { rx: (p.flip ? f.halfDepth : f.halfWidth), ry: (p.flip ? f.halfWidth : f.halfDepth) };
  return { ...p.contact, rx: box.rx * p.scale, ry: box.ry * p.scale };
}
const gap = (e, x, y) => Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx), Math.max(0, Math.abs(y - e.y) - e.ry));

test('every edge of the walk mask is marked by a wall, column, rubble, shrub or tree', () => {
  const world = court(), cells = new Set(world.tiles.map(key));
  const blockers = props().flatMap(p => p.colliders ? p.colliders.map(c => ({ x: c.x, y: c.y, rx: c.halfWidth, ry: c.halfDepth })) : [extent(p)])
    .filter(Boolean);
  let edges = 0;
  for (const p of world.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // The breach opens onto the orchard's corridor: no edge there (orchard-layout.test.js).
    if (cells.has(key({ x: p.x + dx, y: p.y + dy })) || p.y + dy > COURTYARD_SEAM || p.x + dx < -13.5) continue;
    const x = p.x + dx * .5, y = p.y + dy * .5;
    assert.ok(blockers.some(e => gap(e, x, y) < 1.15), `invisible wall at ${x},${y}`);
    edges++;
  }
  assert.ok(edges > 60);
});

test('front ruins stay low so they never hide the hero; tall art stands behind the cloister', () => {
  const tiles = new Set(court().tiles.map(key));
  for (const p of props().filter(p => !p.layer && p.kind !== 'brazier')) {
    const f = courtyardFootprint(p.kind), c = p.collider ?? p.contact ?? p.colliders[0];
    if (p.id.startsWith('column-') || p.id === 'arch' || p.id.startsWith('gate-post-')) continue;
    let behind = Infinity;
    for (let k = 1; k <= 16; k++) {
      if (tiles.has(`${Math.round(c.x - k * Math.SQRT1_2)},${Math.round(c.y - k * Math.SQRT1_2)}`)) { behind = k; break; }
    }
    // The renderer fades a prop over the hero, but a tall front wall would
    // still hide most of the cloister floor behind it.
    if (behind < 4) assert.ok(f.height * p.scale <= 1.65, `${p.id} (${p.kind}) is too tall in front of playable ground`);
  }
});

test('no courtyard prop crosses the road seam or stands in the road mouth', () => {
  for (const p of props()) {
    const c = p.collider ?? p.contact ?? p.colliders[0];
    assert.ok(c.y < COURTYARD_SEAM - .4, `${p.id} reaches into the road area`);
    if (c.y > 8.6 && !p.layer) assert.ok(Math.abs(c.x) > 3.4, `${p.id} blocks the road mouth`);
  }
});

test('the outer country is filled with the camp’s stone masses, cypress groves and shrubs', () => {
  const outer = props().filter(p => p.id.startsWith('grove-'));
  for (const family of ['cypress', 'bush', 'outcrop']) assert.ok(outer.some(p => p.kind.startsWith(family)), family);
  const contacts = outer.map(p => p.collider ?? p.contact);
  // Every 3u cell of the visible country within 16u of the cloister has a prop within 4u.
  const tiles = court().tiles;
  let checked = 0;
  for (let y = -26; y <= 12; y += 3) for (let x = -26; x <= 26; x += 3) {
    const d = Math.min(...tiles.map(t => Math.abs(t.x - x) + Math.abs(t.y - y)));
    // West of x -9.5 the orchard dresses the meadow (orchard-layout.test.js).
    if (d < 4 || d > 16 || (y > 8 && Math.abs(x) < 6) || x < -9.5) continue;
    assert.ok(props().some(p => { const c = p.collider ?? p.contact ?? p.colliders[0]; return Math.hypot(c.x - x, c.y - y) < 4; }),
      `empty meadow at ${x},${y}`);
    checked++;
  }
  assert.ok(checked > 60 && contacts.length > 80);
});

test('solid courtyard props use their world collider centres once, while ground art stays traversable', () => {
  const world = court();
  const colliders = props().flatMap(p => p.colliders ?? (p.collider ? [p.collider] : []));
  assert.equal(world.obstacles.length, colliders.length);
  for (const c of colliders) {
    assert.ok(world.obstacles.includes(c));
    assert.equal(isWalkable(c.x, c.y, .23, world), false);
  }
  assert.ok(world.obstacles.length < 90, 'distant decor must not lengthen every collision query');
  for (const p of props().filter(p => p.layer === 'ground')) assert.equal(p.collider, undefined);
});

async function projection(t) {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 });
  // The ritual seal draws on a canvas; the test only needs its calls to exist.
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('contact-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 5.625, orthoBottom: -5.625 });
  const fetch = t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  fetch.mock.restore();
  const world = buildPixelWorld(scene, assets, court());
  scene.render();
  const pngs = new Map();
  const png = sprite => {
    const url = sprite.atlas === assets.monasteryRuins ? '../assets/game/pixel-v11/monastery-ruins/monastery-ruins.png'
      : '../assets/game/pixel-v9/camp-panorama/camp-panorama.png';
    if (!pngs.has(url)) pngs.set(url, readPng(new URL(url, import.meta.url)));
    return pngs.get(url);
  };
  const project = p => Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
  const pixel = (sprite, x, y) => {
    const u = ((sprite.flip ? sprite.atlas.cell - x : x) - sprite.atlas.anchor[0]) / 32, v = (sprite.atlas.anchor[1] - y) / 32;
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
  return { assets, world, project, pixel, opaque, scene, camera };
}

test('ruin and country contacts project onto their ground centres', async t => {
  const { assets, world, project, pixel } = await projection(t);
  let checked = 0;
  for (const sprite of world.props.filter(s => s.placement)) {
    const p = sprite.placement, c = p.contact ?? p.collider, f = courtyardFootprint(p.kind);
    if (!f || ![assets.monasteryRuins, assets.campPanorama].includes(sprite.atlas)) continue;
    const drawn = pixel(sprite, ...f.contactCenter), centre = project(new Vector3(c.x, p.layer === 'ground' ? 0 : sprite.mesh.position.y - .03, c.y));
    assert.ok(Math.abs(drawn.x - centre.x) < .05, `${p.id}: contact is sideways from its centre`);
    assert.ok(Math.abs(drawn.y - centre.y) < .85, `${p.id}: the lower anchor was used as the support centre`);
    checked++;
  }
  assert.ok(checked > 150);
});

test('walking into walls, columns, rubble and country props stops at their drawn base', async t => {
  const { assets, world, project, opaque } = await projection(t);
  const solids = world.props.filter(s => s.placement?.collider || s.placement?.colliders);
  assert.ok(solids.filter(s => s.atlas === assets.monasteryRuins).length >= 20);
  for (const sprite of solids) {
    const p = sprite.placement, pixels = opaque(sprite), ground = sprite.mesh.position.y - .03;
    for (const c of p.colliders ?? [p.collider]) {
      // Isolate each obstacle so neighbours or the walk mask cannot stop the body first.
      const floor = { obstacles: [c], tiles: [] };
      for (let x = Math.floor(c.x) - 6; x <= Math.ceil(c.x) + 6; x++) for (let y = Math.floor(c.y) - 6; y <= Math.ceil(c.y) + 6; y++) floor.tiles.push({ x, y });
      // The front and both screen-side approaches, as in the camp.
      for (const [dx, dy] of [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2]]) {
        const body = { x: c.x + 4 * dx, y: c.y + 4 * dy, radius: .23 };
        for (let i = 0; i < 420; i++) moveBody(body, -.01 * dx, -.01 * dy, floor);
        const near = project(new Vector3(body.x - body.radius * dx, ground, body.y - body.radius * dy));
        const distance = Math.min(...pixels.map(q => Math.hypot(q.x - near.x, q.y - near.y)));
        // Overhang on the frontal approach (the body walks straight up the
        // screen): no drawing may reach below the stop point in its column, or
        // the feet would stand on stone. Side rows cross the prop's own faces.
        const frontal = dx > 0 && dy > 0;
        const overhang = frontal ? Math.max(0, ...pixels.filter(q => Math.abs(q.x - near.x) < 1).map(q => q.y - near.y)) : 0;
        if (process.env.COURT_MARGINS) console.log('MARGIN', p.id, p.kind, dx.toFixed(2), dy.toFixed(2), distance.toFixed(2), overhang.toFixed(2));
        else {
          // Tighter than the camp's 3 × scale + 1.5 px: every courtyard approach meets stone within 2 px.
          assert.ok(distance <= 2, `${p.id}: transparent contact margin ${distance.toFixed(2)} native px`);
          assert.ok(overhang <= 2, `${p.id}: the drawing reaches ${overhang.toFixed(2)} native px past the collider`);
        }
      }
    }
  }
});

test('the dais runes glow only while the guards hold the seal, never after it opens or breaks', async t => {
  const { assets, world, scene } = await projection(t);
  const dais = world.props.find(sprite => sprite.placement?.id === 'ritual-plinth');
  assert.ok(dais && dais.placement.layer === 'ground' && !dais.placement.collider, 'the dais is walkable ground art');
  assert.equal(world.ritual.standOn, 0, 'the source stands in the socket at ground height');
  const frame = name => assets.monasteryRuins.frames.indexOf(name);
  const view = Object.assign(Object.create(Renderer.prototype), { world });
  const source = { kind: 'ritual', hp: 132, maxHp: 132, sealed: true };
  const show = () => { view.updateLocationState({ enemies: [source] }, 0); scene.render(); return dais.frame; };
  assert.equal(show(), frame('ritual-plinth-runes'));
  source.sealed = false;
  assert.equal(show(), frame('ritual-plinth'), 'the open source turns cyan; the magenta runes go dark');
  source.hp = 0;
  assert.equal(show(), frame('ritual-plinth'), 'a destroyed source keeps the dais plain');
  const { rim } = dais.placement;
  assert.ok(world.ritual.rings.every(ring => ring.position.y > rim.height), 'bindings lie on top of the dais rim');
  for (const mesh of [...world.ritual.rings.map(ring => ({ r: ring.getBoundingInfo().boundingBox.extendSize.x })),
    ...world.ritual.shards.map(post => ({ r: Math.hypot(post.position.x, post.position.z - court().ritual.y) }))]) {
    assert.ok(mesh.r > rim.inner && mesh.r < rim.outer, 'bindings and posts stand on the rim, around the socket');
  }
});

test('the arch fades over an actor behind it or inside its passage', async t => {
  const { assets, world, scene, camera } = await projection(t);
  camera.target.set(0, 0, -8);
  const arch = world.gate, monk = createSprite(scene, 'monk', assets.monk);
  assert.equal(arch.placement.id, 'arch');
  const view = Object.assign(Object.create(Renderer.prototype), { scene, camera, assets, world, monk, hounds: [], width: 640, height: 360 });
  const [pier] = arch.placement.colliders, passage = courtyardFootprint('arch-gate').passage;
  // Billboards sort by their front corner, so the arch also fades just in front
  // of its face; well in front it is opaque again.
  for (const [y, faded] of [[pier.y - pier.halfDepth - .5, true], [arch.placement.contact.y + passage.y, true], [pier.y + 4, false]]) {
    monk.mesh.position.set(0, .025, y);
    view.updateOcclusion({ enemies: [] });
    assert.equal(arch.material.alpha, faded ? .25 : 1, `monk at y ${y}`);
  }
});

test('courtyard and road braziers and the road shrine use the restyled pixel-v11 world frames', async t => {
  const { assets, world, scene } = await projection(t);
  assert.equal(world.fires.length, 4);
  for (const fire of world.fires) {
    assert.equal(fire.sprite.atlas, assets.monasteryWorld);
    assert.ok(assets.monasteryWorld.clips[fire.clip].front.includes(fire.sprite.frame));
  }
  const road = buildPixelWorld(scene, assets, LOCATIONS.road);
  assert.equal(road.shrine.atlas, assets.monasteryWorld);
  assert.equal(road.shrine.frame, assets.monasteryWorld.clips.shrine.front[0]);
  assert.ok(road.fires.every(fire => fire.sprite.atlas === assets.monasteryWorld));
  assert.ok(assets.monasteryWorld.mask, 'hit masks keep occlusion and picking for the new frames');
  road.dispose();
});

// Pins of the restyled courtyard. The v11 columns (0.5 boxes instead of the
// old √½ squares) and the moved braziers changed where the encounter rules
// place the guards for many seeds; that placement is accepted. A later art
// or layout edit must not move guards or gameplay anchors silently: update
// these hashes on purpose and say so in the report. The orchard breach widened the rows y 1..3
// to x -9 (the contract hash); the guards kept their places.
test('the courtyard gameplay contract and its guard placement stay pinned', () => {
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const world = court();
  const contract = ['id', 'title', 'subtitle', 'regions', 'encounters', 'portals', 'spawn', 'entries', 'exit', 'ritual', 'braziers', 'pillars']
    .map(field => [field, world[field]]);
  assert.equal(sha(contract), '26f4e8c430dce0f6536b656745187aeac1d19a8e17aadc709da0e223b1ede05f');
  // Seeded wanderers and pack sizes (encounter-layout §4.3) re-pinned the guards.
  const expected = {
    20261023: [19, '9be5dbd9f17f252cfb6bfa71e24d1a377ec203244a3f2529d861dd8ee620c794'],
    1: [17, '82876ee50d91d70888d0d9ac0577075d6141b182f9c5c37cb1b98967b2985a79'],
    12345: [22, '134293a35bb9c010560ce5f1233336c77f3e161629ee0580dd3a6fc3b2f7dd89'],
  };
  for (const [seed, [count, hash]] of Object.entries(expected)) {
    const guards = createOverworld(Number(seed)).encounters.filter(e => e.zoneId === 'courtyard')
      .map(e => [e.id, e.kind, +e.x.toFixed(4), +e.y.toFixed(4)]);
    assert.equal(guards.length, count);
    assert.equal(sha(guards), hash, `seed ${seed}: courtyard guards moved`);
  }
});
