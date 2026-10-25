import test from 'node:test';
import assert from 'node:assert/strict';
import { CEMETERY_LAYOUT } from '../src/cemetery-layout.js';
import { ORCHARD_LAYOUT } from '../src/orchard-layout.js';
import { LOCATIONS } from '../src/campaign.js';
import { dressSideZone, sideFootprint } from '../src/zone-dressing.js';

const centre = p => p.contact ?? p.collider;
for (const [id, layout] of [['cemetery', CEMETERY_LAYOUT], ['orchard', ORCHARD_LAYOUT]]) {
  test(`${id}: each enlarged field has its own ground detail without new collision`, () => {
    const flats = layout.setDressing.filter(p => p.layer === 'ground');
    for (const [x0, x1, y0, y1] of layout.regions.filter(([x0, x1, y0, y1]) => (x1 - x0 + 1) * (y1 - y0 + 1) > 20)) {
      const inside = flats.filter(p => { const c = centre(p); return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1; });
      assert.ok(inside.length >= 2, `bare district ${[x0, x1, y0, y1]}`);
    }
    for (const p of flats) assert.equal(p.collider ?? p.colliders, undefined, `${p.id} changes combat collision`);
  });
}

test('cemetery: the funerary facade is scenery beyond the walk, with the cache approach open', () => {
  const facade = CEMETERY_LAYOUT.setDressing.filter(p => p.id.startsWith('crypt-'));
  assert.ok(facade.some(p => p.kind === 'wall-window-x'), 'a recognisable stone funerary facade');
  for (const p of facade) {
    assert.equal(p.collider ?? p.colliders, undefined, `${p.id}: distant scenery must not collide`);
    const c = centre(p);
    const f = sideFootprint('cemetery', p.kind).f;
    const rx = f.radius ?? f.halfWidth, ry = f.radius ?? f.halfDepth;
    assert.ok(LOCATIONS.cemetery.tiles.every(t => Math.hypot(Math.max(0, Math.abs(c.x - t.x) - rx), Math.max(0, Math.abs(c.y - t.y) - ry)) >= 1.2), p.id);
  }
});

test('cemetery: grave ash does not paint a false danger patch onto the paved route', () => {
  for (const p of CEMETERY_LAYOUT.setDressing.filter(p => p.kind === 'grave-ash')) {
    const c = centre(p), { f } = sideFootprint('cemetery', p.kind);
    assert.ok(LOCATIONS.cemetery.paving.every(t => Math.abs(c.x - t.x) >= f.halfWidth + .5 || Math.abs(c.y - t.y) >= f.halfDepth + .5), p.id);
  }
});


test('cemetery: a thinner outer grove keeps every collision and authored landmark', () => {
  const rows = CEMETERY_LAYOUT.setDressing.filter(p => !/^(edge|spill|grove)-/.test(p.id))
    .map(p => { const c = centre(p); return [p.id, p.kind, c.x, c.y]; });
  const tables = { edgeSmall: 'cairn-small', edge: [['cairn-small', 1]], spill: [['urn-broken', 1]],
    near: [['bush-round', 1]], mid: [['yew-small', 1]], far: [['yew-round', 1]] };
  const full = dressSideZone('cemetery', { regions: CEMETERY_LAYOUT.regions, rows, tables, salt: 300 });
  const thin = dressSideZone('cemetery', { regions: CEMETERY_LAYOUT.regions, rows, tables, salt: 300, outerDensity: .5 });
  const collisions = props => props.flatMap(p => p.colliders ?? (p.collider ? [p.collider] : []));
  assert.ok(thin.length < full.length, 'the phone budget can reduce distant cosmetic sprites');
  assert.deepEqual(collisions(thin), collisions(full), 'no navigation or encounter geometry changes');
  for (const [id] of rows) assert.deepEqual(thin.find(p => p.id === id), full.find(p => p.id === id), id);
});
