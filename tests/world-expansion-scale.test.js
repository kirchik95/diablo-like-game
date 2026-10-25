import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERWORLD, createOverworld } from '../src/overworld.js';
import { xpReward, monsterLevelForZone } from '../src/progression.js';

const seeds = [0, 1, 4294967295, 20261023, ...Array.from({ length: 96 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0)];
const before = { camp: 711, road: 632, courtyard: 385, cemetery: 352, orchard: 319 };

test('every zone has about twice the walk area while keeping one continuous world and the same loot sites', () => {
  for (const zone of OVERWORLD.zones) {
    const ratio = zone.tiles.length / before[zone.id];
    assert.ok(ratio >= 1.8 && ratio <= 2.2, `${zone.id}: area ×${ratio}`);
  }
  assert.deepEqual(OVERWORLD.caches.map(p => p.id), ['secret', 'cemetery-cache', 'orchard-cache']);
  assert.deepEqual(OVERWORLD.shrines.map(p => p.id), ['road-shrine', 'orchard-shrine']);
  assert.equal(OVERWORLD.portals.length, 0);
});

test('the larger authored packs cannot see another pack from their spawn positions', () => {
  // 7.5 is the longest monster aggro range (wraith); the spatial buffer is independent of seed.
  for (const seed of seeds) {
    const packs = createOverworld(seed).encounters.filter(e => !e.wander);
    for (let i = 0; i < packs.length; i++) for (let j = i + 1; j < packs.length; j++) {
      if (packs[i].packId === packs[j].packId) continue;
      assert.ok(Math.hypot(packs[i].x - packs[j].x, packs[i].y - packs[j].y) >= 7.5,
        `${seed}: ${packs[i].id} sees ${packs[j].id}`);
    }
  }
});

test('expanded main path and spine clears stay within the agreed experience bands', () => {
  let monsters = 0;
  for (const seed of seeds) {
    const world = createOverworld(seed), packs = new Map();
    for (const e of world.encounters) packs.set(e.packId, [...packs.get(e.packId) ?? [], e]);
    const xp = keep => [...packs].filter(([id, members]) => keep(id, members)).reduce((total, [, members]) => total
      + (members[0].wander ? 0 : xpReward('pack'))
      + members.reduce((sum, e) => sum + xpReward(e.kind, monsterLevelForZone(e.zoneId)), 0), xpReward('ritual'));
    const spine = members => ['road', 'courtyard'].includes(members[0].zoneId);
    const main = xp((id, members) => spine(members) && id !== 'road-thicket' && !members[0].side);
    const fullSpine = xp((id, members) => spine(members)) + xpReward('secret');
    assert.ok(main >= 760 && main <= 1000, `${seed}: main ${main}`);
    assert.ok(fullSpine >= 1100 && fullSpine <= 1300, `${seed}: spine ${fullSpine}`);
    monsters += world.encounters.length;
  }
  assert.ok(monsters / seeds.length >= 92 && monsters / seeds.length <= 104, `mean monsters ${monsters / seeds.length}`);
});
