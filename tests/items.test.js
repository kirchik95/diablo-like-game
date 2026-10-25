import test from 'node:test';
import assert from 'node:assert/strict';
import { MONK_RULES } from '../src/monk-combat.js';
import {
  AFFIXES, EQUIPMENT_SLOTS, ITEM_RULES, LOOT_SITES, RARITIES, RELICS, UNARMED_COMBO, WEAPON_FAMILIES,
  affixValue, applyItemStats, comboStats, createInventory, createItem, createStarterWeapons, dropFromBag,
  equipFromBag, isBagFull, lootForSite, pickUpItem, rollRunLoot, unequipWeapon, weaponCombo, weaponPower,
} from '../src/items.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const FULL_ROUTE = ['road-approach', 'road-thicket', 'road-crossing', 'road-gate', 'court-entrance', 'court-source', 'court-ritual'];
const MAIN_ROUTE = FULL_ROUTE.filter(id => id !== 'road-thicket');
const ROAD_PACKS = ['road-approach', 'road-thicket', 'road-crossing', 'road-gate'];
const COURT_PACKS = ['court-entrance', 'court-source'];
// The cemetery and orchard packs follow the ritual in LOOT_SITES (world-expansion §6.3).
const SIDE_PACKS = ['cemetery-graves', 'cemetery-obelisk', 'orchard-press', 'orchard-well'];
const SIDE_CACHES = ['cemetery-cache', 'orchard-cache'];
const SEEDS = Array.from({ length: 2000 }, (_, index) => index * 7919 + 13);
const claimAll = (loot, order, family = 'staff') =>
  Object.fromEntries(order.map(siteId => [siteId, lootForSite(loot, siteId, family)]));
const rare = (id, family, ilvl, affixes) => createItem({ id, family, ilvl, rarity: 'rare', affixes });

test('rule tables are frozen and expose one v1 slot, three rarities, six affixes and two relics', () => {
  assert.deepEqual(EQUIPMENT_SLOTS.map(slot => slot.id), ['weapon', 'beads', 'robe', 'belt', 'wraps']);
  assert.deepEqual(EQUIPMENT_SLOTS.filter(slot => slot.available).map(slot => slot.id), ['weapon']);
  assert.deepEqual(EQUIPMENT_SLOTS.filter(slot => slot.onSprite).map(slot => slot.id), ['weapon']);
  assert.deepEqual(Object.values(RARITIES).map(({ id, color, gems, affixes, relic }) => [id, color, gems, affixes, relic]), [
    ['common', '--ivory', 0, 0, false], ['rare', '--spirit', 1, 2, false], ['relic', '--amber', 2, 2, true],
  ]);
  assert.deepEqual(Object.keys(AFFIXES), ['comboDamage', 'skillDamage', 'spiritPerStrike', 'maxHp', 'cooldownReduction', 'hpPerKill']);
  assert.deepEqual(Object.values(AFFIXES).map(affix => affix.word), ['ярости', 'ясности', 'дыхания', 'крепости', 'ветра', 'жатвы']);
  assert.deepEqual(Object.values(RELICS).map(relic => [relic.id, relic.family]), [['crane-neck', 'staff'], ['quiet-thunder', 'knuckles']]);
  assert.equal(ITEM_RULES.bagSize, 8);
  assert.equal(ITEM_RULES.pickupRadius, .85);
  for (const table of [ITEM_RULES, EQUIPMENT_SLOTS, WEAPON_FAMILIES, RARITIES, AFFIXES, RELICS, LOOT_SITES, UNARMED_COMBO]) {
    assert.ok(Object.isFrozen(table));
  }
  assert.throws(() => { WEAPON_FAMILIES.staff.combo.damage[0] = 1; }, TypeError);
});

test('knuckles strike four times for 10 spirit at 80% run speed and pierce an open shell on the 4th hit', () => {
  const { combo, special, piercesShellFront, cracksShell } = WEAPON_FAMILIES.knuckles;
  assert.equal(combo.strikes, 4);
  assert.deepEqual(combo.damage, [19, 21, 25, 47]);
  assert.deepEqual(combo.hitTime, [.06, .06, .08, .13]);
  assert.deepEqual(combo.range, [1.3, 1.3, 1.4, 1.6]);
  assert.deepEqual(combo.arc, [70, 70, 76, 87]);
  assert.deepEqual(combo.knockback, [.08, .08, .12, .45]);
  assert.deepEqual([combo.spiritPerStrike, combo.attackMoveMultiplier, combo.resetTime], [10, .8, .7]);
  assert.deepEqual([special.id, special.strikeIndex, special.openShellMultiplier], ['pierce', 3, 1.5]);
  assert.deepEqual([piercesShellFront, cracksShell], [false, false]);
  assert.equal(RELICS[WEAPON_FAMILIES.knuckles.relic].family, 'knuckles');
});

test('the staff strikes three times at 2.1–2.4u, sweeps 360° on the 3rd hit and destroys shots but not the shell front', () => {
  const { combo, special, piercesShellFront, cracksShell } = WEAPON_FAMILIES.staff;
  assert.equal(combo.strikes, 3);
  assert.deepEqual(combo.damage, [34, 38, 70]);
  assert.deepEqual(combo.hitTime, [.13, .14, .22]);
  assert.deepEqual(combo.range, [2.1, 2.2, 2.4]);
  assert.deepEqual(combo.arc, [102, 102, 180], '180° half-angle is the full circle');
  assert.equal(combo.dot[2], -1);
  assert.deepEqual(combo.knockback, [.35, .4, .9]);
  assert.deepEqual([combo.spiritPerStrike, combo.attackMoveMultiplier, combo.resetTime], [14, .5, 1]);
  assert.deepEqual([special.id, special.destroysProjectiles], ['deflect', true]);
  assert.deepEqual([piercesShellFront, cracksShell], [false, false]);
});

test('every combo lands each strike inside its duration and the unarmed combo stays MONK_RULES', () => {
  for (const combo of [UNARMED_COMBO, WEAPON_FAMILIES.knuckles.combo, WEAPON_FAMILIES.staff.combo]) {
    for (const key of ['damage', 'duration', 'hitTime', 'range', 'dot', 'knockback', 'arc']) assert.equal(combo[key].length, combo.strikes);
    combo.hitTime.forEach((hit, index) => assert.ok(hit < combo.duration[index]));
  }
  for (const key of Object.keys(MONK_RULES.combo)) assert.deepEqual(UNARMED_COMBO[key], MONK_RULES.combo[key]);
  assert.deepEqual(UNARMED_COMBO.arc, [78, 87, 96]);
  assert.equal(UNARMED_COMBO.spiritPerStrike, MONK_RULES.spirit.perStrike);
  assert.equal(UNARMED_COMBO.attackMoveMultiplier, MONK_RULES.attackMoveMultiplier);
  assert.equal(weaponCombo(null), UNARMED_COMBO);
});

test('series damage and single-target DPS match §3.2 and the §6.3 level 5 and level 10 strikes', () => {
  const [knuckles, staff] = createStarterWeapons();
  assert.deepEqual(comboStats(null), { damage: [24, 30, 48], seriesTime: .77, dps: 132, spiritPerStrike: 12 });
  assert.deepEqual(comboStats(knuckles), { damage: [19, 21, 25, 47], seriesTime: .74, dps: 151, spiritPerStrike: 10 });
  assert.deepEqual(comboStats(staff), { damage: [34, 38, 70], seriesTime: 1.06, dps: 134, spiritPerStrike: 14 });
  // Level 5 is ×1.16; the rare item level 2 weapon carries «урон серии +10%».
  const ashStaff = rare('ash', 'staff', 2, ['cooldownReduction', 'comboDamage']);
  assert.equal(ashStaff.name, 'Ясеневый посох ветра');
  assert.deepEqual(comboStats(ashStaff, 1.16), { damage: [48, 53, 98], seriesTime: 1.06, dps: 188, spiritPerStrike: 14 });
  assert.deepEqual(comboStats(rare('bronze', 'knuckles', 2, ['comboDamage', 'maxHp']), 1.16).damage, [27, 29, 35, 66]);
  // Level 10 is ×1.36 with a rare item level 8 weapon and «+22%».
  assert.deepEqual(comboStats(rare('s8', 'staff', 8, ['comboDamage', 'maxHp']), 1.36).damage, [96, 107, 197]);
  assert.deepEqual(comboStats(rare('k8', 'knuckles', 8, ['comboDamage', 'maxHp']), 1.36).damage, [54, 59, 71, 133]);
  assert.equal(comboStats(rare('breath', 'staff', 3, ['spiritPerStrike', 'maxHp'])).spiritPerStrike, 16);
});

test('affix values follow the §3.4 formulas and cooldown reduction stops at 15%', () => {
  const expected = {
    comboDamage: [8, 10, 12], skillDamage: [8, 10, 12], spiritPerStrike: [1, 1, 2],
    maxHp: [10, 14, 18], cooldownReduction: [6, 7, 8], hpPerKill: [2, 2, 3],
  };
  for (const [id, values] of Object.entries(expected)) assert.deepEqual([1, 2, 3].map(ilvl => affixValue(id, ilvl)), values, id);
  assert.equal(affixValue('comboDamage', 8), 22);
  assert.equal(affixValue('cooldownReduction', 10), 15);
  assert.equal(affixValue('cooldownReduction', 20), 15);
});

test('items take the family base of their item level and a rarity-shaped name', () => {
  const names = [1, 2, 3, 5].map(ilvl => [createItem({ id: 'k', family: 'knuckles', ilvl }), createItem({ id: 's', family: 'staff', ilvl })]);
  assert.deepEqual(names.map(pair => pair.map(item => item.name)), [
    ['Кастеты послушника', 'Посох послушника'], ['Бронзовые кастеты', 'Ясеневый посох'],
    ['Кастеты пилигрима', 'Посох пилигрима'], ['Кастеты пилигрима', 'Посох пилигрима'],
  ]);
  assert.equal(names[1][1].base, 'ash-staff');
  const relic = createItem({ id: 'r', family: 'staff', ilvl: 2, rarity: 'relic', relic: 'crane-neck', affixes: ['hpPerKill', 'maxHp'] });
  assert.deepEqual(relic.affixes, [{ id: 'hpPerKill', value: 2 }, { id: 'maxHp', value: 14 }]);
  assert.equal(relic.name, 'Журавлиная шея');
  assert.ok(Object.isFrozen(relic) && Object.isFrozen(relic.affixes[0]));
  assert.throws(() => createItem({ id: 'x', family: 'staff', rarity: 'rare', affixes: ['maxHp'] }));
  assert.throws(() => createItem({ id: 'x', family: 'staff', rarity: 'rare', affixes: ['maxHp', 'maxHp'] }));
  assert.throws(() => createItem({ id: 'x', family: 'staff', rarity: 'common', affixes: ['maxHp'] }));
  assert.throws(() => createItem({ id: 'x', family: 'staff', rarity: 'relic', relic: 'quiet-thunder', affixes: ['maxHp', 'hpPerKill'] }));
  assert.throws(() => createItem({ id: 'x', family: 'sword' }));
});

test('camp supplies give a common item level 1 knuckles and staff with no affixes', () => {
  const starters = createStarterWeapons();
  assert.deepEqual(starters.map(({ id, family, rarity, ilvl, affixes, relic }) => [id, family, rarity, ilvl, affixes.length, relic]), [
    ['camp-knuckles', 'knuckles', 'common', 1, 0, null], ['camp-staff', 'staff', 'common', 1, 0, null],
  ]);
  assert.deepEqual(createStarterWeapons(), starters);
  assert.deepEqual(lootForSite(rollRunLoot(5), 'camp-supplies'), starters);
});

test('one seed always rolls the same loot and different seeds roll different loot', () => {
  const allSites = LOOT_SITES.map(site => site.id);
  assert.deepEqual(rollRunLoot(20261023), rollRunLoot(20261023));
  assert.deepEqual(claimAll(rollRunLoot(77), allSites, 'knuckles'), claimAll(rollRunLoot(77), allSites, 'knuckles'));
  assert.deepEqual(rollRunLoot(-1), rollRunLoot(0xffffffff), 'seeds normalise like world seeds');
  const signatures = new Set(SEEDS.slice(0, 20).map(seed => JSON.stringify(claimAll(rollRunLoot(seed), allSites))));
  assert.ok(signatures.size > 15);
  assert.throws(() => rollRunLoot(undefined), TypeError);
});

test('loot rolls never call Math.random', () => {
  const random = Math.random;
  Math.random = () => { throw new Error('loot must use the seeded stream'); };
  try {
    for (const seed of SEEDS.slice(0, 50)) rollRunLoot(seed);
  } finally {
    Math.random = random;
  }
});

test('claim order does not change any item', () => {
  for (const seed of SEEDS.slice(0, 200)) {
    const routeOrder = LOOT_SITES.map(site => site.id);
    const shuffled = ['orchard-well', 'court-ritual', 'road-gate', 'cemetery-cache', 'secret', 'court-entrance', 'orchard-press',
      'road-thicket', 'camp-supplies', 'cemetery-obelisk', 'road-approach', 'orchard-cache', 'court-source', 'cemetery-graves',
      'road-crossing'];
    assert.deepEqual([...shuffled].sort(), [...routeOrder].sort());
    const first = createInventory(), second = createInventory();
    for (const siteId of routeOrder.slice(0, 4)) for (const item of lootForSite(rollRunLoot(seed), siteId, 'staff')) pickUpItem(first, item);
    for (const siteId of ['secret', 'road-thicket', 'road-approach', 'camp-supplies']) {
      for (const item of lootForSite(rollRunLoot(seed), siteId, 'staff')) pickUpItem(second, item);
    }
    const byId = inventory => Object.fromEntries(inventory.bag.filter(Boolean).map(item => [item.id, item]));
    assert.deepEqual(byId(first), byId(second));
    assert.deepEqual(claimAll(rollRunLoot(seed), routeOrder), claimAll(rollRunLoot(seed), shuffled));
  }
});

test('drop sites follow §3.5: 8 items on the main path, 16 on a full clear with the cemetery and the orchard', () => {
  for (const seed of SEEDS.slice(0, 300)) {
    const loot = rollRunLoot(seed);
    const main = LOOT_SITES.filter(site => !site.side).flatMap(site => lootForSite(loot, site.id, 'staff'));
    const full = LOOT_SITES.flatMap(site => lootForSite(loot, site.id, 'staff'));
    assert.equal(main.length, 8);
    assert.equal(full.length, 16);
    assert.equal(new Set(full.map(item => item.id)).size, 16);
    for (const siteId of ROAD_PACKS) {
      const [item] = lootForSite(loot, siteId);
      assert.equal(item.id, `drop-${siteId}`);
      assert.equal(item.ilvl, 1);
      assert.ok(['common', 'rare'].includes(item.rarity));
    }
    for (const siteId of COURT_PACKS) {
      const [item] = lootForSite(loot, siteId);
      assert.equal(item.ilvl, 2);
      assert.ok(['common', 'rare'].includes(item.rarity));
    }
    const [ritual] = lootForSite(loot, 'court-ritual');
    assert.deepEqual([ritual.rarity, ritual.ilvl, ritual.relic], ['rare', 3, null]);
    // Cemetery packs roll at item level 2, orchard packs at 3, both with a 50% rare chance.
    for (const siteId of SIDE_PACKS) {
      const [item] = lootForSite(loot, siteId);
      assert.deepEqual([item.id, item.source, item.ilvl], [`drop-${siteId}`, siteId, siteId.startsWith('cemetery') ? 2 : 3]);
      assert.ok(['common', 'rare'].includes(item.rarity));
    }
    for (const item of full) {
      assert.equal(item.affixes.length, RARITIES[item.rarity].affixes);
      assert.equal(new Set(item.affixes.map(affix => affix.id)).size, item.affixes.length);
      item.affixes.forEach(({ id, value }) => assert.equal(value, affixValue(id, item.ilvl)));
    }
  }
  assert.deepEqual(lootForSite(rollRunLoot(1), 'unknown-site'), []);
});

test('rare chances approach 30% on the road and 50% in the courtyard, and families split near 50/50', () => {
  const loots = SEEDS.map(seed => rollRunLoot(seed));
  const share = (sites, predicate) => {
    const items = loots.flatMap(loot => sites.flatMap(siteId => lootForSite(loot, siteId)));
    return items.filter(predicate).length / items.length;
  };
  const isRare = item => item.rarity === 'rare';
  assert.ok(Math.abs(share(ROAD_PACKS, isRare) - .3) < .03);
  assert.ok(Math.abs(share(COURT_PACKS, isRare) - .5) < .03);
  assert.ok(Math.abs(share(SIDE_PACKS, isRare) - .5) < .03);
  assert.ok(Math.abs(share(FULL_ROUTE, item => item.family === 'staff') - .5) < .03);
});

test('neither the main path nor a full clear ever rolls three drops of one family in a row', () => {
  for (const seed of SEEDS) {
    const loot = rollRunLoot(seed);
    for (const route of [MAIN_ROUTE, FULL_ROUTE, [...FULL_ROUTE, ...SIDE_PACKS]]) {
      const families = route.map(siteId => lootForSite(loot, siteId)[0].family);
      for (let index = 2; index < families.length; index++) {
        assert.ok(!(families[index] === families[index - 1] && families[index] === families[index - 2]),
          `seed ${seed}: ${families.join(',')}`);
      }
    }
  }
});

test('the cache relic follows the equipped family and falls back to a seeded family when unarmed', () => {
  const fallbacks = new Set();
  for (const seed of SEEDS.slice(0, 200)) {
    const loot = rollRunLoot(seed);
    for (const family of ['knuckles', 'staff']) {
      const [relic] = lootForSite(loot, 'secret', family);
      assert.deepEqual([relic.family, relic.rarity, relic.ilvl, relic.relic], [family, 'relic', 2, WEAPON_FAMILIES[family].relic]);
      assert.deepEqual(lootForSite(rollRunLoot(seed), 'secret', family), [relic]);
    }
    const [unarmed] = lootForSite(loot, 'secret', null);
    assert.deepEqual(lootForSite(loot, 'secret', unarmed.family), [unarmed]);
    fallbacks.add(unarmed.family);
    // The cemetery reliquary and the gardener's cache give the same relics at item level 3, the «пилигрим» base.
    for (const siteId of SIDE_CACHES) {
      for (const family of ['knuckles', 'staff']) {
        const [relic] = lootForSite(loot, siteId, family);
        assert.deepEqual([relic.id, relic.family, relic.rarity, relic.ilvl, relic.relic], [`drop-${siteId}`, family, 'relic', 3, WEAPON_FAMILIES[family].relic]);
      }
      const [fallback] = lootForSite(loot, siteId, null);
      assert.deepEqual(lootForSite(loot, siteId, fallback.family), [fallback]);
    }
  }
  assert.deepEqual([...fallbacks].sort(), ['knuckles', 'staff']);
});

test('the cemetery and orchard sites come after the old ones and leave every old drop as it was', async () => {
  const { createHash } = await import('node:crypto');
  const old = ['camp-supplies', 'road-approach', 'road-thicket', 'secret', 'road-crossing', 'road-gate', 'court-entrance',
    'court-source', 'court-ritual'];
  assert.deepEqual(LOOT_SITES.map(site => site.id), [...old, 'cemetery-graves', 'cemetery-obelisk', 'cemetery-cache',
    'orchard-press', 'orchard-well', 'orchard-cache']);
  assert.ok(LOOT_SITES.slice(old.length).every(site => site.side));
  // Hashed over these seeds before the six sites were added.
  const hash = createHash('sha256');
  for (const seed of SEEDS) hash.update(JSON.stringify(Object.fromEntries(old.map(id => [id, rollRunLoot(seed).drops[id]]))));
  assert.equal(hash.digest('hex'), '2a50dc291bc05f8d2803a7017153b03ec3c797b390dc7072d708ca5ba82d26ca');
});

test('the bag holds 8 items and a full bag refuses the pickup', () => {
  const inventory = createInventory(), loot = rollRunLoot(9);
  const items = [...createStarterWeapons(), ...FULL_ROUTE.map(siteId => lootForSite(loot, siteId)[0])];
  assert.equal(inventory.bag.length, ITEM_RULES.bagSize);
  items.slice(0, 8).forEach((item, index) => assert.deepEqual(pickUpItem(inventory, item), { ok: true, slot: index }));
  assert.equal(isBagFull(inventory), true);
  const before = [...inventory.bag];
  assert.deepEqual(pickUpItem(inventory, items[8]), { ok: false, reason: 'bag-full' });
  assert.deepEqual(inventory.bag, before);
  assert.equal(ITEM_RULES.bagFullNotice, 'Сумка полна · I — выбросить лишнее');
  inventory.bag[3] = null;
  assert.deepEqual(pickUpItem(inventory, items[0]), { ok: false, reason: 'held' });
});

test('equipping swaps the old weapon into the chosen bag slot', () => {
  const inventory = createInventory(), [knuckles, staff] = createStarterWeapons();
  pickUpItem(inventory, knuckles); pickUpItem(inventory, staff);
  assert.deepEqual(equipFromBag(inventory, 1), { ok: true, item: staff, previous: null });
  assert.deepEqual(inventory.bag.slice(0, 2), [knuckles, null]);
  assert.equal(inventory.equipped.weapon, staff);
  assert.deepEqual(equipFromBag(inventory, 0), { ok: true, item: knuckles, previous: staff });
  assert.deepEqual(inventory.bag.slice(0, 2), [staff, null]);
  assert.equal(inventory.equipped.weapon, knuckles);
  assert.equal(weaponCombo(inventory.equipped.weapon).strikes, 4);
  assert.deepEqual(equipFromBag(inventory, 5), { ok: false, reason: 'empty' });
});

test('unequipping returns the unarmed series and needs a free bag slot', () => {
  const inventory = createInventory(), [knuckles, staff] = createStarterWeapons(), loot = rollRunLoot(11);
  pickUpItem(inventory, staff); equipFromBag(inventory, 0);
  assert.deepEqual(unequipWeapon(inventory), { ok: true, slot: 0 });
  assert.equal(inventory.equipped.weapon, null);
  assert.equal(weaponCombo(inventory.equipped.weapon), UNARMED_COMBO);
  assert.deepEqual(unequipWeapon(inventory), { ok: false, reason: 'empty' });
  equipFromBag(inventory, 0);
  for (const item of [knuckles, ...FULL_ROUTE.map(siteId => lootForSite(loot, siteId)[0])]) pickUpItem(inventory, item);
  assert.equal(isBagFull(inventory), true);
  assert.deepEqual(unequipWeapon(inventory), { ok: false, reason: 'bag-full' });
  assert.equal(inventory.equipped.weapon, staff);
});

test('a dropped item leaves the bag and picks up again unchanged', () => {
  const inventory = createInventory(), [knuckles, staff] = createStarterWeapons();
  pickUpItem(inventory, knuckles); pickUpItem(inventory, staff);
  const dropped = dropFromBag(inventory, 0);
  assert.deepEqual(dropped, { ok: true, item: knuckles });
  assert.deepEqual(inventory.bag.slice(0, 2), [null, staff]);
  assert.deepEqual(dropFromBag(inventory, 0), { ok: false, reason: 'empty' });
  assert.deepEqual(pickUpItem(inventory, dropped.item), { ok: true, slot: 0 });
  assert.equal(inventory.bag[0], knuckles);
  assert.deepEqual(inventory.bag[0], createStarterWeapons()[0]);
});

test('equipped affixes add to the stats object and the weapon sets its power', () => {
  const base = { maxHp: 124, maxSpirit: 115, spiritPerStrike: 10, cooldownReduction: .12 };
  const unarmed = applyItemStats(base, { weapon: null });
  assert.deepEqual(unarmed, { ...base, weaponPower: 1, comboDamage: 0, skillDamage: 0, hpPerKill: 0 });
  const item = rare('w', 'staff', 2, ['maxHp', 'cooldownReduction']);
  const stats = applyItemStats(base, { weapon: item });
  assert.deepEqual([stats.maxHp, stats.maxSpirit, stats.spiritPerStrike, stats.hpPerKill], [138, 115, 10, 0]);
  close(stats.weaponPower, 1.1);
  close(stats.cooldownReduction, .15);
  assert.equal(base.maxHp, 124, 'the input stats stay untouched');
  const fury = applyItemStats({}, { weapon: rare('f', 'knuckles', 3, ['comboDamage', 'skillDamage']) });
  close(fury.comboDamage, .12); close(fury.skillDamage, .12); close(fury.weaponPower, 1.2);
  const inventory = createInventory();
  pickUpItem(inventory, rare('h', 'knuckles', 3, ['hpPerKill', 'spiritPerStrike'])); equipFromBag(inventory, 0);
  const harvest = applyItemStats({ spiritPerStrike: 10 }, inventory.equipped);
  assert.deepEqual([harvest.hpPerKill, harvest.spiritPerStrike], [3, 12]);
  close(weaponPower(rare('p', 'staff', 8, ['maxHp', 'hpPerKill'])), 1.7);
  assert.equal(weaponPower(null), 1);
});
