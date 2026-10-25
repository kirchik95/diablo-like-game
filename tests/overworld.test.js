import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable, clearLine, findPath, moveBody } from '../src/world.js';

test('one immutable world joins the three areas and the two side zones without travel triggers', () => {
  assert.equal(OVERWORLD.id, 'overworld');
  // The spine keeps indices 0..2; the side zones follow.
  assert.deepEqual(OVERWORLD.zones.map(z => z.id), ['camp', 'road', 'courtyard', 'cemetery', 'orchard']);
  assert.deepEqual(OVERWORLD.portals, []);
  assert.equal(new Set(OVERWORLD.tiles.map(p => `${p.x},${p.y}`)).size, OVERWORLD.tiles.length);
  assert.ok(Object.isFrozen(OVERWORLD));
  assert.ok(OVERWORLD.zones.every(z => Object.isFrozen(z) && z.portals.length === 0));
  assert.equal(getOverworldZone(0, 3).id, 'camp');
  assert.equal(getOverworldZone(0, -43).id, 'road');
  assert.equal(getOverworldZone(0, -101).id, 'courtyard');
  assert.equal(getOverworldZone(17, -65).id, 'cemetery');
  assert.equal(getOverworldZone(-15, -119).id, 'orchard');
  // The spur and the breach belong to the spine.
  assert.equal(getOverworldZone(14, -65).id, 'road');
  assert.equal(getOverworldZone(-13, -118).id, 'courtyard');
});

test('every zone lists its caches and shrines by id, and the world lists them all', () => {
  const ids = list => list.map(p => [p.id, p.zoneId, p.x, p.y]);
  assert.deepEqual(ids(OVERWORLD.caches), [['secret', 'road', -23, -71], ['cemetery-cache', 'cemetery', 18, -84],
    ['orchard-cache', 'orchard', -39, -119.5]]);
  assert.deepEqual(ids(OVERWORLD.shrines), [['road-shrine', 'road', -23, -64], ['orchard-shrine', 'orchard', -30, -125]]);
  assert.deepEqual(OVERWORLD.zones.map(z => z.caches.map(p => p.id)), [[], ['secret'], [], ['cemetery-cache'], ['orchard-cache']]);
  assert.deepEqual(OVERWORLD.zones.map(z => z.shrines.map(p => p.id)), [[], ['road-shrine'], [], [], ['orchard-shrine']]);
  // The road's single cache and shrine keep their old fields.
  assert.deepEqual(OVERWORLD.secret, { x: -23, y: -71 });
  assert.deepEqual(OVERWORLD.shrine, { x: -23, y: -64 });
});

test('both joins are walkable by actors in both directions, with no position jump', () => {
  for (const seam of [-41.5, -99.5]) for (const direction of [-1, 1]) {
    for (const x of [-1.3, 0, 1.3]) {
      const body = { x, y: seam - direction * 2, radius: .29 };
      const start = body.y;
      for (let i = 0; i < 40; i++) moveBody(body, 0, direction * .1, OVERWORLD);
      assert.ok(Math.abs(body.y - start - direction * 4) < 1e-8);
    }
  }
});

test('all monster spawns are distinct, walkable, outside camp and grouped', () => {
  const count = OVERWORLD.encounters.length;
  assert.equal(new Set(OVERWORLD.encounters.map(e => e.id)).size, count);
  assert.equal(new Set(OVERWORLD.encounters.map(e => `${e.x},${e.y}`)).size, count);
  assert.equal(count, 101);
  assert.equal(OVERWORLD.encounters.filter(e => e.zoneId === 'road' || e.zoneId === 'courtyard').length, 60);
  assert.equal(OVERWORLD.encounters.filter(e => e.zoneId === 'cemetery' || e.zoneId === 'orchard').length, 41);
  const packs = new Map();
  for (const e of OVERWORLD.encounters) {
    assert.ok(isWalkable(e.x, e.y, .29, OVERWORLD), e.id);
    assert.equal(getOverworldZone(e.x, e.y).id, e.zoneId);
    assert.ok(e.y < OVERWORLD.safeArea.minY - 7, e.id);
    packs.set(e.packId, (packs.get(e.packId) || 0) + 1);
  }
  // Authored packs hold 3 to 6 monsters; wanderers walk alone, in pairs or in threes (side ones
  // alone or in pairs).
  assert.ok([...packs].every(([id, size]) => id.startsWith('wander-') ? size >= 1 && size <= 3
    : id.startsWith('side-wander-') ? size >= 1 && size <= 2 : size >= 3 && size <= 9));
});

test('camp composition is preserved and remote obstacles translate with their art', () => {
  const camp = OVERWORLD.zones[0], road = OVERWORLD.zones[1];
  assert.deepEqual(camp.setDressing, LOCATIONS.camp.setDressing);
  assert.deepEqual(camp.spawn, LOCATIONS.camp.spawn);
  assert.equal(road.shrine.y, LOCATIONS.road.shrine.y - 72);
  assert.equal(road.obstacles[0].y, LOCATIONS.road.obstacles[0].y - 72);
  assert.equal(LOCATIONS.road.shrine.y, 8);
  assert.ok(Object.isFrozen(OVERWORLD.encounters[0]));
});

test('main quest and optional trail remain reachable in a single collision world', () => {
  const from = OVERWORLD.spawn;
  for (const point of [OVERWORLD.ritual, OVERWORLD.reward, ...OVERWORLD.caches, ...OVERWORLD.shrines]) {
    assert.ok(isWalkable(point.x, point.y, .23, OVERWORLD));
    const path = findPath(from, point, .23, OVERWORLD);
    assert.ok(path.length > 0, JSON.stringify(point));
    assert.ok(Math.hypot(path.at(-1).x - point.x, path.at(-1).y - point.y) < 1);
  }
  assert.ok(clearLine({ x: 0, y: -36 }, { x: 0, y: -129 }, .29, OVERWORLD));
});
