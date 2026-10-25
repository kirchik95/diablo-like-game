import test from 'node:test';
import assert from 'node:assert/strict';
import { ORCHARD_LAYOUT } from '../src/orchard-layout.js';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD } from '../src/overworld.js';
import { findPath } from '../src/world.js';
import { sideLayoutTests } from './helpers/side-zone-checks.js';

sideLayoutTests('orchard', ORCHARD_LAYOUT, {
  counts: { tiles: 619, paving: 49 },
  onWalk: ['press', 'well', 'statue', 'old-olive', 'olive-1', 'olive-2', 'olive-3', 'olive-4', 'olive-5', 'fig', 'pergola',
    'press-baskets', 'press-jars', 'well-basin', 'well-bench', 'herb-bed-1', 'herb-bed-2', 'beehives', 'terrace-beehive'],
});

test('orchard: the corridor from the breach leads to the press yard, the shrine and the cache', () => {
  const world = LOCATIONS.orchard;
  // The entry is the corridor's mouth at the courtyard's breach (world x -15).
  assert.deepEqual(OVERWORLD.zones.find(z => z.id === 'orchard').entries.courtyard, { x: -15, y: -119 });
  for (const radius of [.23, .29]) {
    const paved = { ...world, tiles: world.paving };
    for (const target of [world.shrine, world.secret]) assert.ok(findPath(world.spawn, target, radius, paved).length);
  }
  // The shrine is the only one in the side zones; the cache sits on the west terrace.
  assert.deepEqual([world.shrine, world.secret], [{ x: -2, y: -5 }, { x: -11, y: .5 }]);
});
