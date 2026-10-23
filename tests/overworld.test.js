import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable, clearLine, findPath, moveBody } from '../src/world.js';

test('one immutable world joins the three areas without travel triggers', () => {
  assert.equal(OVERWORLD.id, 'overworld');
  assert.deepEqual(OVERWORLD.portals, []);
  assert.equal(new Set(OVERWORLD.tiles.map(p => `${p.x},${p.y}`)).size, OVERWORLD.tiles.length);
  assert.ok(Object.isFrozen(OVERWORLD));
  assert.ok(OVERWORLD.zones.every(z => Object.isFrozen(z) && z.portals.length === 0));
  assert.equal(getOverworldZone(0, 3).id, 'camp');
  assert.equal(getOverworldZone(0, -31).id, 'road');
  assert.equal(getOverworldZone(0, -72).id, 'courtyard');
});

test('both joins are walkable by actors in both directions, with no position jump', () => {
  for (const seam of [-29.5, -70.5]) for (const direction of [-1, 1]) {
    for (const x of [-1.3, 0, 1.3]) {
      const body = { x, y: seam - direction * 2, radius: .29 };
      const start = body.y;
      for (let i = 0; i < 40; i++) moveBody(body, 0, direction * .1, OVERWORLD);
      assert.ok(Math.abs(body.y - start - direction * 4) < 1e-8);
    }
  }
});

test('all 34 monster spawns are distinct, walkable, outside camp and grouped', () => {
  assert.equal(OVERWORLD.encounters.length, 34);
  assert.equal(new Set(OVERWORLD.encounters.map(e => e.id)).size, 34);
  assert.equal(new Set(OVERWORLD.encounters.map(e => `${e.x},${e.y}`)).size, 34);
  assert.equal(OVERWORLD.encounters.filter(e => e.zoneId === 'road').length, 22);
  assert.equal(OVERWORLD.encounters.filter(e => e.zoneId === 'courtyard').length, 12);
  const packs = new Map();
  for (const e of OVERWORLD.encounters) {
    assert.ok(isWalkable(e.x, e.y, .29, OVERWORLD), e.id);
    assert.equal(getOverworldZone(e.x, e.y).id, e.zoneId);
    assert.ok(e.y < OVERWORLD.safeArea.minY - 7, e.id);
    packs.set(e.packId, (packs.get(e.packId) || 0) + 1);
  }
  assert.ok([...packs.values()].every(size => size >= 4 && size <= 6));
});

test('camp composition is preserved and remote obstacles translate with their art', () => {
  const camp = OVERWORLD.zones[0], road = OVERWORLD.zones[1];
  assert.deepEqual(camp.setDressing, LOCATIONS.camp.setDressing);
  assert.deepEqual(camp.spawn, LOCATIONS.camp.spawn);
  assert.equal(road.shrine.y, LOCATIONS.road.shrine.y - 51);
  assert.equal(road.obstacles[0].y, LOCATIONS.road.obstacles[0].y - 51);
  assert.equal(LOCATIONS.road.shrine.y, 6);
  assert.ok(Object.isFrozen(OVERWORLD.encounters[0]));
});

test('main quest and optional trail remain reachable in a single collision world', () => {
  const from = OVERWORLD.spawn;
  for (const point of [OVERWORLD.ritual, OVERWORLD.secret, OVERWORLD.shrine, OVERWORLD.reward]) {
    assert.ok(isWalkable(point.x, point.y, .23, OVERWORLD));
    const path = findPath(from, point, .23, OVERWORLD);
    assert.ok(path.length > 0, JSON.stringify(point));
    assert.ok(Math.hypot(path.at(-1).x - point.x, path.at(-1).y - point.y) < 1);
  }
  assert.ok(clearLine({ x: 0, y: -24 }, { x: 0, y: -91 }, .29, OVERWORLD));
});
