import test from 'node:test';
import assert from 'node:assert/strict';
import * as maps from '../src/overworld.js';
import { isWalkable, clearLine } from '../src/world.js';
import { BEETLE_STATS } from '../src/campaign.js';
import { createEncounterLayout, sideAreas } from '../src/encounter-layout.js';

const fingerprint = world => world.encounters.map(e => [e.id, e.kind, e.packId, e.x, e.y]);
// Authored packs: [id, smallest, largest, beetles]. Every pack keeps at least one wraith.
const expectedPacks = [['road-approach', 7, 8, 0], ['road-crossing', 7, 8, 1], ['road-gate', 6, 7, 2],
  ['road-thicket', 7, 8, 2], ['court-entrance', 7, 8, 1], ['court-source', 7, 8, 2]];
// The main road's narrow stretches: beside the thicket island and the gate corridor.
const necks = [{ x: [-5, 5], y: [-70.5, -67.5] }, { x: [-5, 5], y: [-107.5, -89.5] }];
// The main layout lives on the spine; the side zones' packs and wanderers follow it
// (tests/side-encounters.test.js).
const spine = e => e.zoneId === 'road' || e.zoneId === 'courtyard';
const sidePacks = sideAreas.map(area => area.id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const groupsOf = enemies => {
  const groups = new Map();
  for (const e of enemies) groups.set(e.packId, [...groups.get(e.packId) ?? [], e]);
  return groups;
};
const random = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
// Tiles reachable from the camp spawn on findPath's graph, for a body radius. Seeds share geography.
const reachable = new Map();
function canReach(e) {
  const radius = e.kind === 'beetle' ? BEETLE_STATS.radius : .29, world = maps.OVERWORLD, key = p => `${p.x},${p.y}`;
  if (!reachable.has(radius)) {
    const start = { x: Math.round(world.spawn.x), y: Math.round(world.spawn.y) }, seen = new Map([[key(start), start]]);
    assert.ok(isWalkable(start.x, start.y, radius, world));
    for (const p of seen.values()) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!seen.has(key(n)) && isWalkable(n.x, n.y, radius, world) && clearLine(p, n, radius, world)) seen.set(key(n), n);
    }
    reachable.set(radius, [...seen.values()]);
  }
  return reachable.get(radius).some(p => distance(p, e) < 1.1 && clearLine(p, e, radius, world));
}

// Every placement rule for one seed; returns the wander groups.
function checkLayout(seed) {
  const world = maps.createOverworld(seed), enemies = world.encounters, groups = groupsOf(enemies);
  const packs = enemies.filter(e => spine(e) && !e.wander), wanderers = enemies.filter(e => spine(e) && e.wander);
  assert.equal(new Set(enemies.map(e => e.id)).size, enemies.length, `${seed}: ids`);
  assert.deepEqual([...groups.keys()].slice(0, 6), expectedPacks.map(([id]) => id), `${seed}: authored packs first`);
  // Then the main wanderers, the side packs and the side wanderers, in this order.
  const order = [...groups.keys()].map(id => id.startsWith('wander-') ? 1 : sidePacks.includes(id) ? 2 : id.startsWith('side-wander-') ? 3 : 0);
  assert.deepEqual(order, [...order].sort(), `${seed}: main layout first`);
  assert.deepEqual([...groups.keys()].filter(id => sidePacks.includes(id)), sidePacks, `${seed}: side packs`);
  for (const [id, min, max, beetles] of expectedPacks) {
    const members = groups.get(id), count = kind => members.filter(e => e.kind === kind).length;
    assert.ok(members.length >= min && members.length <= max, `${seed}:${id}: ${members.length} members`);
    assert.equal(count('beetle'), beetles, `${seed}:${id}: beetles`);
    assert.ok(count('wraith') >= 1 && count('hound') >= 1, `${seed}:${id}: wraith and hound`);
    assert.ok(members.every(e => !e.wander && !e.side), `${seed}:${id}: pack flags`);
  }
  const wanderGroups = [...groups.entries()].filter(([id]) => id.startsWith('wander-'));
  assert.ok(wanderGroups.length >= 6 && wanderGroups.length <= 14, `${seed}: ${wanderGroups.length} wander groups`);
  const sizes = wanderGroups.map(([, members]) => members.length);
  assert.ok(sizes.includes(2) && sizes.filter(size => size > 1).length >= 2, `${seed}: a pair and one more pair or trio`);
  for (const [i, [packId, members]] of wanderGroups.entries()) {
    assert.equal(packId, `wander-${i + 1}`);
    assert.ok(members.length >= 1 && members.length <= 3, `${seed}:${packId}: size`);
    assert.equal(new Set(members.map(e => e.zoneId)).size, 1, `${seed}:${packId}: one zone`);
    assert.equal(new Set(members.map(e => !!e.side)).size, 1, `${seed}:${packId}: one trail flag`);
    const allowed = members[0].zoneId === 'road' ? ['hound', 'wraith'] : ['hound', 'wraith', 'beetle'];
    assert.ok(members.every(e => allowed.includes(e.kind)), `${seed}:${packId}: kinds in ${members[0].zoneId}`);
    if (members.some(e => e.kind === 'beetle')) assert.equal(members.length, 1, `${seed}:${packId}: a beetle wanders alone`);
    for (const e of members) {
      assert.equal(e.wander, true);
      assert.ok(distance(e, members[0]) <= 2.2 + 1e-9, `${seed}:${e.id}: group spread`);
      assert.ok(packs.every(p => distance(e, p) >= 5 - 1e-9), `${seed}:${e.id}: pack gap`);
      assert.ok(wanderers.every(o => o.packId === packId || distance(e, o) >= 5 - 1e-9), `${seed}:${e.id}: group gap`);
      for (const point of [world.shrine, world.secret, world.ritual]) {
        assert.ok(distance(e, point) >= 3 - 1e-9, `${seed}:${e.id}: reserved point`);
      }
      assert.ok(!necks.some(n => e.x >= n.x[0] && e.x <= n.x[1] && e.y >= n.y[0] && e.y <= n.y[1]), `${seed}:${e.id}: neck`);
      // Side-trail wanderers stand west of the main road.
      if (e.side) assert.ok(e.zoneId === 'road' && e.x < -5, `${seed}:${e.id}: side trail`);
    }
  }
  for (const [i, e] of enemies.entries()) {
    const clearance = e.kind === 'beetle' ? BEETLE_STATS.radius + .25 : .54;
    assert.ok(isWalkable(e.x, e.y, clearance, world), `${seed}:${e.id}: collision margin`);
    assert.equal(maps.getOverworldZone(e.x, e.y).id, e.zoneId);
    assert.ok(e.y < world.safeArea.minY - 7, `${seed}:${e.id}: camp buffer`);
    assert.ok(Math.abs(e.y + 99.5) >= 3, `${seed}:${e.id}: courtyard seam buffer`);
    for (const point of [world.shrine, world.secret, world.ritual]) {
      assert.ok(distance(e, point) >= 2.2, `${seed}:${e.id}: reserved point`);
    }
    for (const other of enemies.slice(i + 1)) assert.ok(distance(e, other) >= 1.35 - 1e-8, `${seed}: spacing`);
    assert.ok(canReach(e), `${seed}:${e.id}: reachable from the camp`);
  }
  return wanderGroups.map(([, members]) => members);
}

test('encounters repeat by seed while different runs change their positions', () => {
  assert.equal(typeof maps.createOverworld, 'function');
  assert.equal(maps.createOverworld(), maps.OVERWORLD);
  assert.equal(maps.createOverworld(maps.DEFAULT_WORLD_SEED), maps.OVERWORLD);
  assert.deepEqual(fingerprint(maps.createOverworld(12345)), fingerprint(maps.createOverworld(12345)));
  assert.notDeepEqual(fingerprint(maps.createOverworld(12345)), fingerprint(maps.createOverworld(54321)));
  assert.equal(maps.createOverworld(-1).seed, 4294967295);
  assert.equal(maps.createOverworld(4294967296).seed, 0);
});

test('seeded layouts preserve geography and keep packs, wanderers and reserves apart', () => {
  for (const seed of [0, 1, 2, 7, 42, 12345, 20261023, 2147483648, 4294967295]) {
    const world = maps.createOverworld(seed), enemies = world.encounters;
    assert.ok(Object.isFrozen(world) && Object.isFrozen(enemies));
    assert.equal(world.tiles, maps.OVERWORLD.tiles);
    assert.equal(world.obstacles, maps.OVERWORLD.obstacles);
    assert.deepEqual(world.zones[0].setDressing, maps.OVERWORLD.zones[0].setDressing);
    for (const zone of world.zones) assert.deepEqual(zone.encounters, enemies.filter(e => e.zoneId === zone.id));
    assert.equal(world.zones[0].encounters.length, 0, 'the camp stays safe');
    assert.ok(enemies.every(e => Object.isFrozen(e)));
    checkLayout(seed);
  }
});

test('the neck rectangles match the narrow stretches of the walk mask', () => {
  for (const neck of necks) {
    for (let y = Math.ceil(neck.y[0]); y <= Math.floor(neck.y[1]); y++) {
      let width = 1;
      for (const step of [-1, 1]) for (let x = step; isWalkable(x, y, .29, maps.OVERWORLD); x += step) width++;
      assert.ok(width <= 9, `row ${y} is ${width} cells wide`);
    }
  }
});

test('200 seeds: every spawn is walkable and reachable, and wanderers mix singles, pairs and trios by zone', () => {
  const next = random(20261023);
  const seeds = [0, 1, 4294967295, maps.DEFAULT_WORLD_SEED, ...Array.from({ length: 196 }, () => Math.floor(next() * 4294967296))];
  const sizes = { 1: 0, 2: 0, 3: 0 }, counts = new Set(), kinds = {}, signatures = new Set();
  let side = 0, wanderers = 0;
  for (const seed of seeds) {
    const groups = checkLayout(seed);
    counts.add(groups.length);
    signatures.add(groups.map(g => `${g.length}@${Math.round(g[0].x / 2)},${Math.round(g[0].y / 2)}`).sort().join(' '));
    for (const group of groups) {
      sizes[group.length]++;
      for (const e of group) {
        wanderers++; side += !!e.side;
        kinds[`${e.zoneId}:${e.kind}`] = (kinds[`${e.zoneId}:${e.kind}`] ?? 0) + 1;
      }
    }
  }
  assert.deepEqual([...counts].filter(count => count < 10).sort(), [6, 7, 8, 9]);
  assert.equal(signatures.size, seeds.length, 'every seed spreads its wanderers differently');
  const groups = sizes[1] + sizes[2] + sizes[3];
  // About 40% singles, 40% pairs and 20% trios.
  assert.ok(sizes[1] / groups > .3 && sizes[1] / groups < .45, `singles ${sizes[1]} of ${groups}`);
  assert.ok(sizes[2] / groups > .35 && sizes[2] / groups < .5, `pairs ${sizes[2]} of ${groups}`);
  assert.ok(sizes[3] / groups > .14 && sizes[3] / groups < .26, `trios ${sizes[3]} of ${groups}`);
  assert.ok(kinds['road:hound'] > 2 * kinds['road:wraith'] && kinds['road:wraith'] > 0, 'road: mostly hounds');
  assert.ok(kinds['courtyard:beetle'] > 0 && kinds['courtyard:beetle'] < .06 * wanderers, 'a lone beetle is rare');
  assert.ok(side > .15 * wanderers && side < .5 * wanderers, `side trail ${side} of ${wanderers}`);
});

test('2000 seeds place every pack and 6 to 14 wander groups, with a pair and one more pair or trio', () => {
  for (let i = 0; i < 2000; i++) {
    const seed = Math.imul(i, 2654435761) >>> 0, enemies = createEncounterLayout(maps.OVERWORLD, seed);
    const groups = groupsOf(enemies), wander = [...groups.keys()].filter(id => id.startsWith('wander-')).length;
    const side = [...groups.keys()].filter(id => id.startsWith('side-wander-')).length;
    assert.equal(groups.size - wander - side, 10, `${seed}: six main and four side packs`);
    assert.ok(side >= 1 && side <= 8, `${seed}: ${side} side wander groups`);
    assert.ok(wander >= 6 && wander <= 14, `${seed}: ${wander} wander groups`);
    const sizes = [...groups].filter(([id]) => id.startsWith('wander-')).map(([, members]) => members.length);
    assert.ok(sizes.includes(2) && sizes.filter(size => size > 1).length >= 2, `${seed}: group sizes ${sizes}`);
  }
});

test('with every wander spot blocked the layout keeps its packs and simply has no wanderers', () => {
  const block = (x0, x1, y0, y1) => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, halfWidth: (x1 - x0) / 2 + 1, halfDepth: (y1 - y0) / 2 + 1 });
  const world = { ...maps.OVERWORLD, obstacles: [...maps.OVERWORLD.obstacles, block(-18.2, -8.4, -65.7, -58.7),
    block(-18.2, -7.7, -77.6, -71.3), block(4.9, 9.1, -67.1, -61.5), block(-9.1, 9.1, -86.7, -81.8),
    block(-11.2, -7.7, -127.7, -116.5), block(7.7, 11.2, -127.7, -116.5), block(-11.2, 11.2, -134.7, -130.5)] };
  for (const seed of [0, 1, maps.DEFAULT_WORLD_SEED]) {
    const enemies = createEncounterLayout(world, seed);
    assert.equal(enemies.filter(e => e.wander && spine(e)).length, 0, `${seed}`);
    assert.deepEqual([...groupsOf(enemies).keys()].filter(id => !id.startsWith('side-wander-')), [...expectedPacks.map(([id]) => id), ...sidePacks]);
  }
});

// Side inputs must not move a main spawn: compare the expanded world against its spine-only pass.
test('the side zones leave the main layout bit-identical', () => {
  const next = random(20261023);
  const seeds = [0, 1, 4294967295, maps.DEFAULT_WORLD_SEED, ...Array.from({ length: 196 }, () => Math.floor(next() * 4294967296))];
  for (const seed of seeds) {
    const world = maps.createOverworld(seed);
    const withoutSides = { ...world, caches: world.caches.filter(c => c.zoneId === 'road') };
    assert.deepEqual(createEncounterLayout(withoutSides, seed), world.encounters.filter(spine), `seed ${seed}: side zones changed spine spawns`);
  }
});

test('default pack placement is asymmetric', () => {
  for (const [pack] of expectedPacks) {
    const enemies = maps.OVERWORLD.encounters.filter(e => e.packId === pack);
    assert.ok(new Set(enemies.map(e => Math.round(e.x * 10))).size >= enemies.length - 1, `${pack}: x rows`);
    assert.ok(new Set(enemies.map(e => Math.round(e.y * 10))).size >= enemies.length - 1, `${pack}: y rows`);
  }
});
