import test from 'node:test';
import assert from 'node:assert/strict';
import { CEMETERY_LAYOUT } from '../src/cemetery-layout.js';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD } from '../src/overworld.js';
import { findPath } from '../src/world.js';
import { sideLayoutTests } from './helpers/side-zone-checks.js';

const byId = id => CEMETERY_LAYOUT.setDressing.find(p => p.id === id);

sideLayoutTests('cemetery', CEMETERY_LAYOUT, {
  counts: { tiles: 686, paving: 46 },
  onWalk: ['gate', 'obelisk', 'lantern-west', 'lantern-east', 'reliquary-lantern', 'broken-obelisk', 'east-cairn',
    'field-mound-west', 'field-mound-east', 'south-slab'],
});

test('cemetery: the gate stands in the throat with a post on each side of the path', () => {
  const gate = byId('gate');
  assert.deepEqual([gate.contact.x, +gate.contact.y.toFixed(2)], [-11.2, 2.8]);
  assert.deepEqual(gate.colliders.map(c => [c.x, +c.y.toFixed(2)]), [[-11.2, 1.25], [-11.2, 4.35]]);
  const world = LOCATIONS.cemetery;
  for (const radius of [.23, .29, .38]) assert.ok(findPath(world.spawn, { x: -8, y: 3 }, radius, world).length, `r${radius}`);
});

test('cemetery: the paved path leads from the gate to the cache; the south graves stay quiet', () => {
  const world = LOCATIONS.cemetery;
  for (const radius of [.23, .29]) assert.ok(findPath(world.spawn, world.secret, radius, { ...world, tiles: world.paving }).length);
  // No spawn area covers the south graves (local y 12..16): a quiet corner beside the camp.
  const zone = OVERWORLD.zones.find(z => z.id === 'cemetery');
  assert.equal(zone.secret.y, CEMETERY_LAYOUT.secret.y - 68);
  assert.ok(OVERWORLD.encounters.filter(e => e.zoneId === 'cemetery').every(e => e.y < -56.5));
});
