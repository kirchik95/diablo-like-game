import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS } from '../src/campaign.js';
import { CAMP_LAYOUT } from '../src/camp-layout.js';
import { hasTile, isWalkable, moveBody, findPath, clearLine } from '../src/world.js';

function walkRoute(world, from, target, radius) {
  const path = findPath(from, target, radius, world);
  assert.ok(path.length > 0, `${world.id}: no route to ${JSON.stringify(target)} for radius ${radius}`);
  const body = { ...from, radius };
  for (const point of [...path, target]) {
    const distance = Math.hypot(point.x - body.x, point.y - body.y);
    const steps = Math.ceil(distance / .08);
    for (let i = 0; i < steps; i++) {
      const dx = point.x - body.x, dy = point.y - body.y, remaining = Math.hypot(dx, dy);
      if (!remaining) break;
      moveBody(body, dx / remaining * Math.min(.08, remaining), dy / remaining * Math.min(.08, remaining), world);
      assert.ok(isWalkable(body.x, body.y, radius, world));
    }
    assert.ok(Math.hypot(point.x - body.x, point.y - body.y) < .1, `${world.id}: movement blocked before route point`);
  }
  assert.ok(Math.hypot(body.x - target.x, body.y - target.y) < .1);
  return path;
}

test('adventure world: every spawn and entry reaches portals, objectives and encounters with actual actor radii', () => {
  assert.deepEqual(Object.keys(LOCATIONS), ['camp', 'road', 'courtyard']);
  for (const world of Object.values(LOCATIONS)) {
    const targets = [...world.portals, ...world.encounters, world.shrine, world.secret, world.ritual, world.reward].filter(Boolean);
    const entries = new Map([world.spawn, ...Object.values(world.entries)].map(point => [`${point.x},${point.y}`, point]));
    for (const entry of entries.values()) {
      for (const radius of [.23, .29]) {
        assert.ok(isWalkable(entry.x, entry.y, radius, world), `${world.id}: unsafe entry`);
        for (const target of targets) walkRoute(world, entry, target, radius);
      }
      assert.ok(world.encounters.every(enemy => Math.hypot(enemy.x - entry.x, enemy.y - entry.y) > 7.5),
        `${world.id}: an arrival must not spawn inside enemy aggro range`);
      assert.ok(world.portals.every(portal => Math.hypot(portal.x - entry.x, portal.y - entry.y) > 1.15),
        `${world.id}: arrival must not immediately activate a reverse portal`);
    }
  }
});

test('adventure world: the side loop is reachable and optional for the main road', () => {
  const road = LOCATIONS.road;
  const main = walkRoute(road, road.spawn, road.portals.find(p => p.target === 'courtyard'), .23);
  assert.ok(main.every(p => Math.hypot(p.x - road.secret.x, p.y - road.secret.y) > 3));
  walkRoute(road, { x: -4, y: 7 }, road.secret, .23);
  walkRoute(road, road.secret, { x: -4, y: -2 }, .23);
  assert.equal(hasTile(-9, 2, road), false, 'the fork must wrap a real gap rather than sit in one open rectangle');
});

test('adventure world: location collision is isolated and shared geometry cannot be mutated by a run', () => {
  const road = LOCATIONS.road, camp = LOCATIONS.camp;
  // A far western camp cell and the carpet's free side, from the camp layout.
  const west = camp.tiles.reduce((a, b) => b.x > a.x ? b : a);
  const rug = camp.setDressing.find(p => p.id === 'carpet');
  assert.equal(hasTile(west.x, west.y, camp), true);
  assert.equal(hasTile(west.x, west.y, road), false);
  assert.equal(isWalkable(rug.contact.x - 1.5, rug.contact.y + 2.2, .23, camp), true);
  const pillar = road.pillars[0];
  assert.equal(isWalkable(pillar.x, pillar.y, .23, road), false);
  assert.equal(clearLine({ x: pillar.x - 2, y: pillar.y }, { x: pillar.x + 2, y: pillar.y }, .13, road), false);
  const body = { x: pillar.x - 2, y: pillar.y, radius: .23 };
  moveBody(body, 4, 0, road);
  assert.ok(body.x < pillar.x - .7, 'a long movement step cannot tunnel through a local pillar');
  assert.throws(() => { road.tiles[0].x = 999; }, TypeError);
  assert.throws(() => { road.encounters.push({ x: 0, y: 17 }); }, TypeError);
});

function reachableCells(world, cells, radius) {
  const key = p => `${p.x},${p.y}`;
  const allowed = new Map(cells.map(p => [key(p), p]));
  const start = allowed.get(`${Math.round(world.spawn.x)},${Math.round(world.spawn.y)}`);
  assert.ok(start, `${world.id}: spawn must belong to the connected surface`);
  const queue = [start], visited = new Set([key(start)]);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const to = allowed.get(`${from.x + dx},${from.y + dy}`);
      if (to && !visited.has(key(to)) && clearLine(from, to, radius, world)) {
        visited.add(key(to)); queue.push(to);
      }
    }
  }
  return visited;
}

test('landscape world: added earth shoulders are usable and connected to the original approach', () => {
  // Camp shoulders: the clearing beside the fire and the grass at both tent doors.
  const campProp = id => LOCATIONS.camp.setDressing.find(p => p.id === id).collider;
  const [left, right] = [campProp('tent-left'), campProp('tent-right')];
  const shoulders = {
    camp: [[-7, 0], [left.x, left.y + left.halfDepth + 1], [right.x + right.halfWidth + 1, right.y]],
    road: [[6, 9], [-6, -7], [3, 17], [-19, 4], [-9, 10], [-9, -4]],
    courtyard: [[8, 0], [0, -11], [3, 12]],
  };
  for (const [id, points] of Object.entries(shoulders)) {
    const world = LOCATIONS[id];
    for (const radius of [.23, .29]) {
      for (const [x, y] of points) {
        assert.ok(isWalkable(x, y, radius, world), `${id}: shoulder (${x},${y}) is missing or blocked`);
        walkRoute(world, world.spawn, { x, y }, radius);
      }
      const usable = world.tiles.filter(p => isWalkable(p.x, p.y, radius, world));
      assert.equal(reachableCells(world, usable, radius).size, usable.length, `${id}: detached walkable island`);
    }
  }
});

test('landscape world: paving is an immutable proper subset with room for actors and prop foundations', () => {
  for (const world of Object.values(LOCATIONS)) {
    assert.ok(Array.isArray(world.paving), `${world.id}: missing paving surface`);
    assert.ok(world.paving.length > 0 && world.paving.length < world.tiles.length / 2,
      `${world.id}: earth shoulders must remain distinct from the narrow paved route`);
    assert.equal(new Set(world.paving.map(p => `${p.x},${p.y}`)).size, world.paving.length);
    for (const p of world.paving) {
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
      assert.ok(hasTile(p.x, p.y, world), `${world.id}: paving outside plateau`);
      assert.ok(isWalkable(p.x, p.y, Math.SQRT1_2, world), `${world.id}: paved cell overlaps a foundation or cliff`);
    }
    assert.throws(() => { world.paving[0].x = 999; }, TypeError);
    assert.throws(() => { world.paving.push({ x: 999, y: 999 }); }, TypeError);
  }
});

test('landscape world: connected paving leads between arrivals and every interaction without crossing earth gaps', () => {
  for (const world of Object.values(LOCATIONS)) {
    assert.ok(Array.isArray(world.paving), `${world.id}: missing paving surface`);
    const pavedWorld = { ...world, tiles: world.paving };
    const targets = [...world.portals, world.shrine, world.secret, world.ritual, world.reward].filter(Boolean);
    for (const radius of [.23, .29]) {
      assert.equal(reachableCells(pavedWorld, world.paving, radius).size, world.paving.length,
        `${world.id}: disconnected paving component`);
      for (const entry of [world.spawn, ...Object.values(world.entries)]) {
        for (const target of targets) walkRoute(pavedWorld, entry, target, radius);
      }
    }
  }
});

test('landscape world: main paths stay about three cells wide and the side loop never advertises a false exit', () => {
  for (const world of Object.values(LOCATIONS)) assert.ok(Array.isArray(world.paving), `${world.id}: missing paving surface`);
  // The camp road runs north to the seam; sample a row halfway along it.
  const campRow = Math.round(CAMP_LAYOUT.pavingRoutes[0].points[2][1]);
  for (const [id, row] of [['camp', campRow], ['road', 12], ['road', -12], ['courtyard', 0]]) {
    const width = LOCATIONS[id].paving.filter(p => p.y === row).length;
    assert.ok(width >= 2 && width <= 3, `${id}: straight main path width ${width}`);
  }
  const road = LOCATIONS.road;
  const branchWidth = road.paving.filter(p => p.x === -9 && p.y >= 4).length;
  assert.ok(branchWidth >= 1 && branchWidth <= 2, `optional branch width ${branchWidth}`);
  assert.equal(hasTile(-9, 2, road), false);
  assert.equal(road.paving.some(p => p.x === -9 && p.y === 2), false);
  assert.equal(LOCATIONS.courtyard.paving.some(p => p.y < -7), false, 'paving must stop at the ritual instead of leading to decorative world.exit');
});
