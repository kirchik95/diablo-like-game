import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { SIDE_ZONES, SIDE_LINKS, SPINE_WALK, sideZoneAt } from '../src/side-zones.js';
import { countryZoneLookup } from '../src/country-zones.js';
import { layoutLandscape } from '../src/landscape.js';
import { isWalkable, clearLine, findPath } from '../src/world.js';
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };

const key = p => `${p.x},${p.y}`;
const zone = id => OVERWORLD.zones.find(z => z.id === id);
const cellsOf = regions => regions.flatMap(([x0, x1, y0, y1]) => {
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
});
const sideTiles = OVERWORLD.tiles.filter(p => sideZoneAt(p.x, p.y));

test('the side zones own disjoint boxes off the spine, and both zone lookups agree on every cell', () => {
  const [a, b] = Object.values(SIDE_ZONES).map(z => z.area);
  assert.ok(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY, 'the boxes overlap');
  const country = countryZoneLookup(OVERWORLD);
  for (const owner of OVERWORLD.zones) for (const p of owner.tiles) {
    assert.equal(getOverworldZone(p.x, p.y).id, owner.id, `${owner.id} cell ${key(p)}`);
    assert.equal(country(p.x, p.y).id, owner.id, `${owner.id} cell ${key(p)}`);
    assert.equal(sideZoneAt(p.x, p.y), owner.area ? owner.id : null);
  }
  for (const id of Object.keys(SIDE_ZONES)) assert.equal(zone(id).area, SIDE_ZONES[id].area);
});

test('SPINE_WALK is the walk mask of the road and the courtyard', () => {
  const spine = new Set(cellsOf(SPINE_WALK).map(key));
  assert.deepEqual(spine, new Set([...zone('road').tiles, ...zone('courtyard').tiles].map(key)));
});

test('each side link is spine ground that opens onto its side zone', () => {
  const tiles = new Set(OVERWORLD.tiles.map(key));
  for (const [id, link] of Object.entries(SIDE_LINKS)) {
    const cells = cellsOf([link]);
    for (const p of cells) {
      assert.ok(tiles.has(key(p)) && !sideZoneAt(p.x, p.y), `${id} link ${key(p)}`);
    }
    // The link's end touches the zone's walk mask, and the zone's entry lies inside the zone.
    const own = new Set(zone(id).tiles.map(key));
    assert.ok(cells.some(p => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => own.has(key({ x: p.x + dx, y: p.y + dy })))), id);
    const entry = Object.values(zone(id).entries)[0];
    assert.ok(own.has(key(entry)), id);
  }
});

test('the enlarged side zones add 1305 cells within twice the original area budget', () => {
  assert.deepEqual(OVERWORLD.zones.map(z => [z.id, z.tiles.length]),
    [['camp', 1393], ['road', 1228], ['courtyard', 801], ['cemetery', 686], ['orchard', 619]]);
  assert.equal(OVERWORLD.tiles.length, 4727);
  for (const id of Object.keys(SIDE_ZONES)) assert.ok(zone(id).tiles.length <= 840, id);
});

test('from the camp, every usable side cell is reachable and paths reach every cache and shrine', () => {
  for (const radius of [.23, .29, .38]) {
    const start = { x: Math.round(OVERWORLD.spawn.x), y: Math.round(OVERWORLD.spawn.y) };
    const seen = new Set([key(start)]), queue = [start];
    for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: queue[i].x + dx, y: queue[i].y + dy };
      if (!seen.has(key(next)) && isWalkable(next.x, next.y, radius, OVERWORLD) && clearLine(queue[i], next, radius, OVERWORLD)) {
        seen.add(key(next)); queue.push(next);
      }
    }
    const usable = sideTiles.filter(p => isWalkable(p.x, p.y, radius, OVERWORLD));
    assert.deepEqual(usable.filter(p => !seen.has(key(p))).map(key), [], `r${radius}`);
  }
  for (const target of [...OVERWORLD.caches, ...OVERWORLD.shrines]) {
    assert.ok(isWalkable(target.x, target.y, .29, OVERWORLD), target.id);
    assert.ok(findPath(OVERWORLD.spawn, target, .29, OVERWORLD).length, target.id);
  }
});

test('no spine prop taller than 1.1 hides a side cell', () => {
  // A standing prop hides the ground up to 2.04 h behind it along the screen's up diagonal.
  const footprints = { ...panorama.footprints, ...ruins.footprints };
  const standing = [];
  for (const owner of OVERWORLD.zones.filter(z => !z.area)) for (const p of owner.setDressing ?? []) {
    if (p.layer === 'ground' || !footprints[p.kind]) continue;
    standing.push({ id: `${owner.id}:${p.id}`, f: footprints[p.kind], scale: p.scale, ...(p.collider ?? p.contact ?? p.colliders[0]) });
  }
  const landscape = layoutLandscape(OVERWORLD);
  for (const p of [...landscape.border, ...landscape.scenery]) {
    if (p.layer !== 'ground' && footprints[p.frame]) standing.push({ id: p.cluster, f: footprints[p.frame], scale: p.scale, ...p.contact });
  }
  let tall = 0;
  for (const prop of standing) {
    const h = prop.f.height * prop.scale, r = (prop.f.radius ?? Math.max(prop.f.halfWidth, prop.f.halfDepth)) * prop.scale;
    if (h <= 1.1) continue;
    tall++;
    for (const t of sideTiles) {
      const dx = prop.x - t.x, dy = prop.y - t.y, along = (dx + dy) / Math.SQRT2, across = Math.abs(dy - dx) / Math.SQRT2;
      assert.ok(!(along > 0 && along < 2.04 * h && across < Math.max(.35, r * .7)), `${prop.id} hides ${key(t)}`);
    }
  }
  assert.ok(tall > 100);
});
