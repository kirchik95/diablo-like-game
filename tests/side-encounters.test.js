import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERWORLD, createOverworld, DEFAULT_WORLD_SEED } from '../src/overworld.js';
import { sideAreas, SIDE_RULES } from '../src/encounter-layout.js';

// The side zones' packs and wanderers (docs/design/world-expansion.md §2.5, §5.2, §5.3). The
// walkability, spacing and reachability of every spawn are in tests/encounter-layout.test.js.
const SIDE = ['cemetery', 'orchard'];
const entryOf = id => Object.values(OVERWORLD.zones.find(z => z.id === id).entries)[0];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const reserved = [...OVERWORLD.caches, ...OVERWORLD.shrines, OVERWORLD.ritual];
const random = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const groupsOf = enemies => {
  const groups = new Map();
  for (const e of enemies) groups.set(e.packId, [...groups.get(e.packId) ?? [], e]);
  return groups;
};

function checkSide(seed) {
  const enemies = createOverworld(seed).encounters.filter(e => SIDE.includes(e.zoneId)), groups = groupsOf(enemies);
  const packs = enemies.filter(e => !e.wander), wanderers = enemies.filter(e => e.wander);
  for (const area of sideAreas) {
    const members = groups.get(area.id);
    // The main pack rule: two or one fewer than the authored kinds, at least three.
    assert.ok(members.length >= Math.max(3, area.kinds.length - 2) && members.length <= area.kinds.length - 1, `${seed}:${area.id}: size`);
    assert.deepEqual(members.map(e => e.kind), area.kinds.slice(0, members.length), `${seed}:${area.id}: kinds`);
    assert.ok(members.every(e => e.zoneId === area.zoneId && !e.wander), `${seed}:${area.id}: zone`);
  }
  for (const e of packs) assert.ok(reserved.every(p => distance(e, p) >= 2.2), `${seed}:${e.id}: reserved point`);
  const wanderGroups = [...groups].filter(([id]) => id.startsWith('side-wander-'));
  assert.equal(wanderGroups.length + sideAreas.length, groups.size, `${seed}: packs and wander groups only`);
  for (const [i, [packId, members]] of wanderGroups.entries()) {
    assert.equal(packId, `side-wander-${i + 1}`);
    assert.ok(members.length >= 1 && members.length <= 2, `${seed}:${packId}: size`);
    const zoneId = members[0].zoneId, allowed = zoneId === 'cemetery' ? ['hound', 'wraith'] : ['hound', 'wraith', 'beetle'];
    assert.ok(members.every(e => e.zoneId === zoneId && allowed.includes(e.kind)), `${seed}:${packId}: kinds in ${zoneId}`);
    if (members.some(e => e.kind === 'beetle')) assert.equal(members.length, 1, `${seed}:${packId}: a beetle wanders alone`);
    for (const e of members) {
      assert.equal(e.id, `${packId}-${members.indexOf(e) + 1}`);
      assert.ok(distance(e, members[0]) <= SIDE_RULES.spread[1] + 1e-9, `${seed}:${e.id}: group spread`);
      assert.ok(packs.every(p => distance(e, p) >= SIDE_RULES.packGap), `${seed}:${e.id}: pack gap`);
      assert.ok(wanderers.every(o => o.packId === packId || distance(e, o) >= SIDE_RULES.groupGap), `${seed}:${e.id}: group gap`);
      assert.ok(reserved.every(p => distance(e, p) >= SIDE_RULES.reserveGap), `${seed}:${e.id}: reserved point`);
    }
  }
  for (const zoneId of SIDE) {
    const own = enemies.filter(e => e.zoneId === zoneId), entry = entryOf(zoneId);
    assert.ok(own.length <= 23, `${seed}:${zoneId}: ${own.length} monsters`);
    assert.ok(own.filter(e => e.wander).length <= SIDE_RULES.zoneMembers, `${seed}:${zoneId}: wanderers`);
    // The entry stays quiet: an arrival never steps into a fight.
    for (const e of own) assert.ok(distance(e, entry) >= 3.5, `${seed}:${e.id}: ${distance(e, entry).toFixed(2)} from the entry`);
  }
  // The cemetery's south graves (y -39..-37, beside the camp) hold no spawn.
  assert.ok(enemies.every(e => e.zoneId !== 'cemetery' || e.y < -56.5), `${seed}: south graves`);
  return wanderGroups.length;
}

test('the default seed puts two packs in each side zone and a few wanderers', () => {
  assert.equal(OVERWORLD.seed, DEFAULT_WORLD_SEED);
  const side = OVERWORLD.encounters.filter(e => SIDE.includes(e.zoneId));
  assert.deepEqual([...new Set(side.filter(e => !e.wander).map(e => e.packId))],
    ['cemetery-graves', 'cemetery-obelisk', 'orchard-press', 'orchard-well']);
  assert.deepEqual(sideAreas.map(a => a.zoneId), ['cemetery', 'cemetery', 'orchard', 'orchard']);
  const groups = checkSide(DEFAULT_WORLD_SEED);
  assert.ok(groups >= SIDE_RULES.groups[0] && groups <= SIDE_RULES.mostGroups);
});

test('400 seeds keep the side rules: sizes, kinds, gaps, the quiet entries and the 23-monster cap', () => {
  const next = random(20261024), counts = new Set();
  for (const seed of [0, 1, 4294967295, ...Array.from({ length: 397 }, () => Math.floor(next() * 4294967296))]) {
    counts.add(checkSide(seed));
  }
  // Groups vary with the seed, within the rule.
  assert.ok(counts.size >= 3 && Math.max(...counts) <= SIDE_RULES.mostGroups, [...counts].join(','));
});
