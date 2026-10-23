import test from 'node:test';
import assert from 'node:assert/strict';
import * as maps from '../src/overworld.js';
import { isWalkable, findPath } from '../src/world.js';

const fingerprint = world => world.encounters.map(e => [e.id, e.kind, e.packId, e.x, e.y]);
const expectedPacks = [['road-approach', 5], ['road-crossing', 6], ['road-gate', 5],
  ['road-thicket', 6], ['court-entrance', 6], ['court-source', 6]];

test('encounters repeat by seed while different runs change their positions', () => {
  assert.equal(typeof maps.createOverworld, 'function');
  assert.equal(maps.createOverworld(), maps.OVERWORLD);
  assert.equal(maps.createOverworld(maps.DEFAULT_WORLD_SEED), maps.OVERWORLD);
  assert.deepEqual(fingerprint(maps.createOverworld(12345)), fingerprint(maps.createOverworld(12345)));
  assert.notDeepEqual(fingerprint(maps.createOverworld(12345)), fingerprint(maps.createOverworld(54321)));
  assert.equal(maps.createOverworld(-1).seed, 4294967295);
  assert.equal(maps.createOverworld(4294967296).seed, 0);
});

test('seeded layouts preserve geography and contain 34 spaced safe monsters', () => {
  assert.equal(typeof maps.createOverworld, 'function');
  for (const seed of [0, 1, 2, 7, 42, 12345, 20261023, 2147483648, 4294967295]) {
    const world = maps.createOverworld(seed), enemies = world.encounters;
    assert.ok(Object.isFrozen(world) && Object.isFrozen(enemies));
    assert.equal(world.tiles, maps.OVERWORLD.tiles);
    assert.equal(world.obstacles, maps.OVERWORLD.obstacles);
    assert.deepEqual(world.zones[0].setDressing, maps.OVERWORLD.zones[0].setDressing);
    assert.equal(enemies.length, 34);
    assert.equal(new Set(enemies.map(e => e.id)).size, 34);
    for (const [pack, count] of expectedPacks) assert.equal(enemies.filter(e => e.packId === pack).length, count);
    assert.equal(enemies.filter(e => e.kind === 'wraith').length, 10);
    assert.deepEqual(world.zones.flatMap(z => z.encounters), enemies);
    for (const [i, e] of enemies.entries()) {
      assert.ok(Object.isFrozen(e));
      assert.ok(isWalkable(e.x, e.y, .54, world), `${seed}:${e.id}: collision margin`);
      assert.equal(maps.getOverworldZone(e.x, e.y).id, e.zoneId);
      assert.ok(e.y < world.safeArea.minY - 7, 'camp buffer');
      assert.ok(Math.abs(e.y + 70.5) >= 3, 'courtyard seam buffer');
      for (const point of [world.shrine, world.secret, world.ritual]) {
        assert.ok(Math.hypot(e.x - point.x, e.y - point.y) >= 2.2, `${seed}:${e.id}: reserved point`);
      }
      for (const other of enemies.slice(i + 1)) {
        assert.ok(Math.hypot(e.x - other.x, e.y - other.y) >= 1.35 - 1e-8, `${seed}: spacing`);
      }
    }
  }
});

test('default pack placement is asymmetric and every spawn can be reached', () => {
  for (const [pack] of expectedPacks) {
    const enemies = maps.OVERWORLD.encounters.filter(e => e.packId === pack);
    assert.ok(new Set(enemies.map(e => Math.round(e.x * 10))).size >= enemies.length - 1, `${pack}: x rows`);
    assert.ok(new Set(enemies.map(e => Math.round(e.y * 10))).size >= enemies.length - 1, `${pack}: y rows`);
    for (const e of enemies) {
      const path = findPath(maps.OVERWORLD.spawn, e, .29, maps.OVERWORLD);
      assert.ok(path.length && Math.hypot(path.at(-1).x - e.x, path.at(-1).y - e.y) < 1.1, e.id);
    }
  }
});
