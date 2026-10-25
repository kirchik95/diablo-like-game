// Shared checks of a side zone's layout (cemetery-layout.test.js, orchard-layout.test.js), from the
// prototype checks of docs/design/world-expansion.md §2.7: frames, the walk mask, the height rule,
// marked edges, colliders and reachability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS } from '../../src/campaign.js';
import { OVERWORLD } from '../../src/overworld.js';
import { SIDE_ZONES, sideZoneAt } from '../../src/side-zones.js';
import { sideFootprint } from '../../src/zone-dressing.js';
import { isWalkable, clearLine } from '../../src/world.js';
import cemetery from '../../assets/game/pixel-v13/cemetery/manifest.json' with { type: 'json' };
import orchard from '../../assets/game/pixel-v13/orchard/manifest.json' with { type: 'json' };
import ruins from '../../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import panorama from '../../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };

const key = (x, y) => `${x},${y}`;
// The renderer's search order for a side zone's frames (pixel-scene.js PROP_ATLASES).
const ATLASES = {
  cemetery: [cemetery.cemetery, ruins.monasteryRuins, panorama.campPanorama],
  orchard: [orchard.orchard, ruins.monasteryRuins, panorama.campPanorama],
};
const FOOTPRINTS = { cemetery: [cemetery, ruins, panorama], orchard: [orchard, ruins, panorama] };

// id: 'cemetery' or 'orchard'. layout: its *_LAYOUT. onWalk: the authored props that stand on
// the walk mask (landmarks and low obstacles). counts: { tiles, paving }.
export function sideLayoutTests(id, layout, { onWalk, counts }) {
  const { offset } = SIDE_ZONES[id], location = LOCATIONS[id];
  const zone = OVERWORLD.zones.find(z => z.id === id);
  const props = layout.setDressing, standing = props.filter(p => !p.layer);
  const walk = new Set(OVERWORLD.tiles.map(p => key(p.x, p.y)));
  // A prop's drawn base in world coordinates: its colliders, or its footprint at its ground centre.
  const extents = p => {
    if (p.colliders) return p.colliders.map(c => ({ x: c.x + offset.x, y: c.y + offset.y, rx: c.halfWidth, ry: c.halfDepth }));
    const { f } = sideFootprint(id, p.kind), c = p.collider ?? p.contact;
    const [rx, ry] = f.shape === 'circle' ? [f.radius, f.radius] : [f.halfWidth, f.halfDepth];
    return [{ x: c.x + offset.x, y: c.y + offset.y, rx, ry }];
  };
  const cellGap = (e, x, y) => Math.hypot(Math.max(0, Math.abs(e.x - x) - .5 - e.rx), Math.max(0, Math.abs(e.y - y) - .5 - e.ry));
  const touchesWalk = p => extents(p).some(e => {
    for (let y = Math.floor(e.y - e.ry - 1); y <= Math.ceil(e.y + e.ry + 1); y++) {
      for (let x = Math.floor(e.x - e.rx - 1); x <= Math.ceil(e.x + e.rx + 1); x++) if (walk.has(key(x, y)) && cellGap(e, x, y) < .02) return true;
    }
    return false;
  });
  const groundCentre = p => { const c = p.contact ?? p.collider; return { x: c.x + offset.x, y: c.y + offset.y }; };

  test(`${id}: one immutable deterministic layout shared by the campaign and the world`, async () => {
    for (const field of ['regions', 'spawn', 'entries', 'secret', 'shrine', 'setDressing']) {
      assert.equal(location[field], layout[field] ?? null, `${field} must not drift in a second layout`);
    }
    assert.ok(Object.isFrozen(layout) && Object.isFrozen(props) && props.every(Object.isFrozen));
    assert.throws(() => { props[0].x = 999; }, TypeError);
    const fresh = await import(`../../src/${id}-layout.js?determinism-check`);
    assert.deepEqual(fresh[`${id.toUpperCase()}_LAYOUT`], layout, 'rows, edges and groves are reproducible');
    assert.equal(new Set(props.map(p => p.id)).size, props.length);
    // OVERWORLD moves the zone as one.
    assert.equal(zone.setDressing.length, props.length);
    for (const [i, p] of props.entries()) {
      const q = zone.setDressing[i], c = p.collider ?? p.contact, d = q.collider ?? q.contact;
      assert.deepEqual([q.x, q.y, d.x, d.y], [p.x + offset.x, p.y + offset.y, c.x + offset.x, c.y + offset.y], p.id);
    }
    assert.deepEqual({ tiles: location.tiles.length, paving: location.paving.length }, counts);
    assert.deepEqual(new Set(zone.tiles.map(p => key(p.x, p.y))),
      new Set(location.tiles.map(p => key(p.x + offset.x, p.y + offset.y))));
  });

  test(`${id}: every frame is drawn and collided from the same atlas, unmirrored at scale 1`, () => {
    for (const p of props) {
      // The renderer takes the first atlas that draws the frame; the layout's footprint must
      // come from that atlas's manifest.
      const index = ATLASES[id].findIndex(atlas => atlas.frames.includes(p.kind));
      assert.ok(index >= 0, `${p.id}: no atlas draws ${p.kind}`);
      assert.equal(sideFootprint(id, p.kind).f, FOOTPRINTS[id][index].footprints[p.kind], `${p.id}: ${p.kind}`);
      // The v13 frames draw each orientation themselves; several have one drawing only.
      assert.equal(p.flip, false, p.id);
      assert.equal(p.scale, 1, p.id);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), p.id);
      const flat = ['flat', 'overlay'].includes(sideFootprint(id, p.kind).f.role);
      assert.equal(p.layer === 'ground', flat, `${p.id}: ground art lies flat, the rest stands`);
    }
  });

  test(`${id}: props stay in the zone's box; only the landmarks stand on the walk mask`, () => {
    for (const p of props) {
      const c = groundCentre(p);
      assert.equal(sideZoneAt(c.x, c.y), id, `${p.id} stands outside the zone`);
    }
    // Ground art lies on the walk mask.
    for (const p of props.filter(p => p.layer)) {
      const c = groundCentre(p);
      assert.ok(walk.has(key(Math.round(c.x), Math.round(c.y))), `${p.id}: ground art off the walk mask`);
    }
    assert.deepEqual(standing.filter(touchesWalk).map(p => p.id), onWalk);
    assert.ok(onWalk.every(id => !/^(edge|spill|grove)-/.test(id)));
  });

  test(`${id}: a prop taller than 1.1 off the walk has 2h + 1 of empty ground up the screen`, () => {
    let tall = 0;
    for (const p of standing.filter(p => !touchesWalk(p))) {
      const { f } = sideFootprint(id, p.kind);
      if (f.height <= 1.1) continue;
      const c = groundCentre(p);
      let behind = Infinity;
      for (let k = 1; k <= 30; k++) if (walk.has(key(Math.round(c.x - k * Math.SQRT1_2), Math.round(c.y - k * Math.SQRT1_2)))) { behind = k; break; }
      assert.ok(behind >= 2 * f.height + 1, `${p.id} (${p.kind}, ${f.height}u) has walkable ground ${behind} behind`);
      tall++;
    }
    assert.ok(tall > 20, 'the outer country holds yews, cypresses and trees');
  });

  test(`${id}: every edge of the walk mask is marked within 1.15 by a standing prop`, () => {
    const blockers = standing.flatMap(extents);
    let edges = 0;
    for (const p of zone.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // The entrance continues into the spine's walk: no edge there.
      if (walk.has(key(p.x + dx, p.y + dy))) continue;
      const x = p.x + dx * .5, y = p.y + dy * .5;
      assert.ok(blockers.some(e => Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx), Math.max(0, Math.abs(y - e.y) - e.ry)) < 1.15),
        `invisible wall at ${x - offset.x},${y - offset.y}`);
      edges++;
    }
    assert.ok(edges > 70);
  });

  test(`${id}: only blockers within 1.2 of the walk collide, and each one blocks`, () => {
    const colliders = props.flatMap(p => p.colliders ?? (p.collider ? [p.collider] : []));
    assert.equal(location.obstacles.length, colliders.length);
    for (const c of colliders) {
      assert.ok(location.obstacles.includes(c));
      assert.equal(isWalkable(c.x, c.y, .23, location), false);
    }
    for (const p of standing.filter(p => !p.collider && !p.colliders)) {
      const [e] = extents(p);
      for (const t of zone.tiles) assert.ok(Math.hypot(Math.max(0, Math.abs(t.x - e.x) - e.rx), Math.max(0, Math.abs(t.y - e.y) - e.ry)) >= 1.2,
        `${p.id} needs its collider`);
    }
    for (const p of props.filter(p => p.layer)) assert.equal(p.collider ?? p.colliders, undefined, p.id);
  });

  test(`${id}: the walk mask is one island from the entry for the hero and the beetle`, () => {
    for (const radius of [.23, .29, .38]) {
      const usable = location.tiles.filter(p => isWalkable(p.x, p.y, radius, location)), allowed = new Map(usable.map(p => [key(p.x, p.y), p]));
      const start = allowed.get(key(location.spawn.x, location.spawn.y)), seen = new Set([key(start.x, start.y)]), queue = [start];
      for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = allowed.get(key(queue[i].x + dx, queue[i].y + dy));
        if (next && !seen.has(key(next.x, next.y)) && clearLine(queue[i], next, radius, location)) { seen.add(key(next.x, next.y)); queue.push(next); }
      }
      assert.equal(seen.size, usable.length, `r${radius}: detached cells`);
      assert.ok(usable.length > counts.tiles * .75, `r${radius}: the props fill too much of the mask`);
    }
  });
}
