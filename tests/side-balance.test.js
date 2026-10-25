import test from 'node:test';
import assert from 'node:assert/strict';
import * as gameApi from '../src/game.js';
import { CAMP_SUPPLIES } from '../src/campaign.js';
import { createOverworld, DEFAULT_WORLD_SEED } from '../src/overworld.js';
import { SIDE_RULES } from '../src/encounter-layout.js';
import { xpReward, monsterLevelForZone, levelForXp } from '../src/progression.js';
import { runSimulationRoute } from './helpers/simulation-route.js';

// The full clear with both side zones (docs/design/world-expansion.md §5.3–5.5): every pack with
// its bonus, every wanderer, the three caches and the ritual. The camp supplies and the shrines
// give no experience.
const fullClearXp = world => {
  const groups = new Map();
  for (const e of world.encounters) groups.set(e.packId, [...groups.get(e.packId) ?? [], e]);
  let xp = xpReward('ritual') + xpReward('secret') * world.caches.length;
  for (const members of groups.values()) {
    xp += members.reduce((sum, e) => sum + xpReward(e.kind, monsterLevelForZone(e.zoneId)), members[0].wander ? 0 : xpReward('pack'));
  }
  return xp;
};
let seed = 20261024;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const SEEDS = [0, 1, 4294967295, DEFAULT_WORLD_SEED, ...Array.from({ length: 996 }, next)];

test('1000 seeds: the full clear gives 2150 to 2550 experience and reaches the full-clear level', () => {
  const totals = [];
  for (const runSeed of SEEDS) {
    const world = createOverworld(runSeed), xp = fullClearXp(world);
    assert.equal(world.caches.length, 3);
    assert.ok(xp >= SIDE_RULES.fullClearXp[0] && xp <= SIDE_RULES.fullClearXp[1], `${runSeed}: full clear ${xp}`);
    assert.equal(levelForXp(xp), 6, `${runSeed}: level`);
    totals.push(xp);
  }
  const mean = totals.reduce((sum, xp) => sum + xp, 0) / totals.length;
  assert.ok(mean > 2150 && mean < 2300, `full clear mean ${mean}`);
});

test('1000 seeds: a side zone holds 15 to 23 monsters', () => {
  const counts = { cemetery: new Set(), orchard: new Set() };
  for (const runSeed of SEEDS) {
    const enemies = createOverworld(runSeed).encounters;
    for (const zoneId of Object.keys(counts)) {
      const count = enemies.filter(e => e.zoneId === zoneId).length;
      assert.ok(count >= 15 && count <= 23, `${runSeed}:${zoneId}: ${count} monsters`);
      counts[zoneId].add(count);
    }
  }
  // The wanderers vary the count with the seed.
  for (const [zoneId, seen] of Object.entries(counts)) assert.ok(seen.size >= 4, `${zoneId}: ${[...seen]}`);
});

test('the simulated full clear of the default seed earns exactly that experience', () => {
  let game;
  const createAdventure = (...args) => (game = gameApi.createAdventure(...args));
  const route = runSimulationRoute({ ...gameApi, CAMP_SUPPLIES, createAdventure }, DEFAULT_WORLD_SEED, { full: true });
  assert.equal(route.phase, 'victory');
  assert.deepEqual(game.adventure.cachesFound, ['secret', 'cemetery-cache', 'orchard-cache']);
  assert.deepEqual(game.progression, { xp: fullClearXp(createOverworld(DEFAULT_WORLD_SEED)), level: 6, path: [] });
  assert.equal(game.progression.xp, 2192);
});
