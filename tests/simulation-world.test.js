import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLine, findPath, hasTile, isWalkable } from '../src/world.js';

function arena(obstacles = []) {
  const tiles = [];
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) tiles.push({ x, y });
  return { tiles, obstacles };
}
const frozen = obstacles => Object.freeze(obstacles.map(o => Object.freeze(o)));

test('frozen circle uses its radius when only one rectangle dimension is present', () => {
  const world = arena(frozen([{ x: 3.9, y: 0, radius: 1, halfWidth: .01 }]));
  assert.equal(isWalkable(4.7, 0, .1, world), false);
  assert.equal(isWalkable(5, 0, .1, world), true);
});

test('indexed collision preserves tangency, negative grid cells and large body radii', () => {
  const world = arena(frozen([{ x: -4, y: -4, radius: .5 },
    { x: 4, y: 4, halfWidth: .5, halfDepth: .75 }]));
  for (const [x, y, radius, expected] of [
    [-3, -4, .5, true], [-3.000001, -4, .5, false],
    [-5, -4, .5, true], [-4.999999, -4, .5, false],
    [5, 4, .5, true], [4.999999, 4, .5, false],
    [4, 4, 0, false], [4, 4, -.1, false],
    [0, -4, 4.1, false], [0, 0, .23, true],
  ]) assert.equal(isWalkable(x, y, radius, world), expected, `${x}, ${y}, r=${radius}`);
});

test('collider edits are observed even when the containing array is frozen', () => {
  const circle = { x: 4, y: 0, radius: .5 };
  const world = arena(Object.freeze([circle]));
  assert.equal(isWalkable(0, 0, .23, world), true);
  circle.x = 0;
  assert.equal(isWalkable(0, 0, .23, world), false);
  world.obstacles = [];
  assert.equal(isWalkable(0, 0, .23, world), true);
  world.obstacles.push({ x: 0, y: 0, halfSize: .5 });
  assert.equal(isWalkable(0, 0, .23, world), false);
  world.obstacles[0].x = 8;
  assert.equal(isWalkable(0, 0, .23, world), true);
});

test('numeric tile lookup retains rounding at negative half tiles and rejects invalid coordinates', () => {
  const world = { tiles: [{ x: 0, y: 0 }, { x: 100000, y: -100000 }], obstacles: [] };
  assert.equal(hasTile(-.5, -.5, world), true);
  assert.equal(hasTile(.5, 0, world), false);
  assert.equal(hasTile(-.500001, 0, world), false);
  assert.equal(hasTile(100000.1, -99999.9, world), true);
  for (const x of [NaN, Infinity, -Infinity]) {
    assert.equal(hasTile(x, 0, world), false);
    assert.equal(isWalkable(x, 0, .23, world), false);
  }
});

test('extreme coordinates and radii fall back without unbounded grid iteration', () => {
  const huge = 1e20;
  const world = { tiles: [{ x: huge, y: 0 }], obstacles: frozen([{ x: huge, y: 0, radius: .5 }]) };
  assert.equal(isWalkable(huge, 0, 0, world), false);
  world.obstacles = frozen([{ x: 0, y: 0, radius: .5 }]);
  assert.equal(isWalkable(huge, 0, 0, world), true);
  const radius = 1e6, tiles = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [-.707, .707], [.707, -.707], [-.707, -.707]]) {
    tiles.push({ x: dx * radius, y: dy * radius });
  }
  assert.equal(isWalkable(0, 0, radius, { tiles, obstacles: frozen([]) }), true);
});

test('frozen and mutable scenery give identical paths and walkable samples', () => {
  const definitions = [{ x: -.3, y: .7, halfWidth: .6, halfDepth: 1.7 },
    { x: 4, y: 3.8, radius: .8 }, { x: -4, y: -4, halfSize: .5 }];
  const mutable = arena(definitions), indexed = arena(frozen(definitions.map(o => ({ ...o }))));
  for (const radius of [0, .05, .23, .29, .5, 1.1, 4.1]) {
    for (let x = -6; x < 6; x += .37) for (let y = -6; y < 6; y += .41) {
      assert.equal(isWalkable(x, y, radius, indexed), isWalkable(x, y, radius, mutable));
    }
    const from = { x: -5, y: 0 }, to = { x: 5, y: 0 };
    assert.equal(clearLine(from, to, radius, indexed), clearLine(from, to, radius, mutable));
    assert.deepEqual(findPath(from, to, radius, indexed), findPath(from, to, radius, mutable));
  }
});
