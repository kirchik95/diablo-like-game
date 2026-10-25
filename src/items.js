import { MONK_RULES } from './monk-combat.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
// Half-angle in degrees for a cosine threshold; a dot of -1 reaches all the way round.
const arcOf = dot => Math.round(Math.acos(dot) * 180 / Math.PI);
const comboRules = ({ damage, dot, ...rest }) => ({ strikes: damage.length, damage, dot, arc: dot.map(arcOf), ...rest });
const FAMILY_IDS = ['knuckles', 'staff'];

export const ITEM_RULES = freeze({
  bagSize: 8, bagColumns: 4, pickupRadius: MONK_RULES.pickup.radius, dropHoldTime: .6,
  weaponPowerPerLevel: .1, maxCooldownReduction: .15,
  bagFullNotice: 'Сумка полна · I — выбросить лишнее',
});

// Only the weapon slot exists in v1. Later slots never change the sprite.
export const EQUIPMENT_SLOTS = freeze([
  { id: 'weapon', name: 'Оружие', available: true, onSprite: true },
  { id: 'beads', name: 'Чётки', available: false, onSprite: false },
  { id: 'robe', name: 'Одеяние', available: false, onSprite: false },
  { id: 'belt', name: 'Пояс', available: false, onSprite: false },
  { id: 'wraps', name: 'Обмотки', available: false, onSprite: false },
]);

// The bare-handed series stays defined by MONK_RULES; this only gives it the weapon combo shape.
export const UNARMED_COMBO = freeze(comboRules({
  ...MONK_RULES.combo,
  spiritPerStrike: MONK_RULES.spirit.perStrike, attackMoveMultiplier: MONK_RULES.attackMoveMultiplier,
}));

// Combo arrays are per strike. `dot` is the cosine threshold game.js tests; `arc` is its half-angle.
// No weapon pierces the beetle's front sector or cracks its shell: the front still takes 25%.
export const WEAPON_FAMILIES = freeze({
  knuckles: {
    id: 'knuckles', name: 'Кастеты', relic: 'quiet-thunder', piercesShellFront: false, cracksShell: false,
    combo: comboRules({
      damage: [19, 21, 25, 47], duration: [.15, .15, .17, .27], hitTime: [.06, .06, .08, .13],
      range: [1.3, 1.3, 1.4, 1.6], dot: [.35, .35, .25, .05], knockback: [.08, .08, .12, .45],
      resetTime: .7, spiritPerStrike: 10, attackMoveMultiplier: .8,
    }),
    // «Пробой»: the last strike hits a beetle from the side, from behind or while stunned for ×1.5.
    special: { id: 'pierce', name: 'Пробой', strikeIndex: 3, openShellMultiplier: 1.5 },
  },
  staff: {
    id: 'staff', name: 'Посох', relic: 'crane-neck', piercesShellFront: false, cracksShell: false,
    combo: comboRules({
      damage: [34, 38, 70], duration: [.3, .32, .44], hitTime: [.13, .14, .22],
      range: [2.1, 2.2, 2.4], dot: [-.2, -.2, -1], knockback: [.35, .4, .9],
      resetTime: 1, spiritPerStrike: 14, attackMoveMultiplier: .5,
    }),
    // «Сбивание»: every staff arc destroys wraith shots at its hit moment.
    special: { id: 'deflect', name: 'Сбивание', destroysProjectiles: true },
  },
});

export const WEAPON_BASES = freeze({
  'novice-knuckles': { id: 'novice-knuckles', family: 'knuckles', ilvl: 1, name: 'Кастеты послушника' },
  'bronze-knuckles': { id: 'bronze-knuckles', family: 'knuckles', ilvl: 2, name: 'Бронзовые кастеты' },
  'pilgrim-knuckles': { id: 'pilgrim-knuckles', family: 'knuckles', ilvl: 3, name: 'Кастеты пилигрима' },
  'novice-staff': { id: 'novice-staff', family: 'staff', ilvl: 1, name: 'Посох послушника' },
  'ash-staff': { id: 'ash-staff', family: 'staff', ilvl: 2, name: 'Ясеневый посох' },
  'pilgrim-staff': { id: 'pilgrim-staff', family: 'staff', ilvl: 3, name: 'Посох пилигрима' },
});

// gems are the 3×3u stones in a bag cell, so rarity reads without colour.
export const RARITIES = freeze({
  common: { id: 'common', name: 'Обычное', color: '--ivory', gems: 0, affixes: 0, relic: false },
  rare: { id: 'rare', name: 'Редкое', color: '--spirit', gems: 1, affixes: 2, relic: false },
  relic: { id: 'relic', name: 'Реликвия', color: '--amber', gems: 2, affixes: 2, relic: true },
});

// value = base + ⌊perLevel × (ilvl − 1)⌋, never above max. Percent values are whole percents.
export const AFFIXES = freeze({
  comboDamage: { id: 'comboDamage', name: 'Урон серии', word: 'ярости', percent: true, base: 8, perLevel: 2 },
  skillDamage: { id: 'skillDamage', name: 'Урон шага и техник', word: 'ясности', percent: true, base: 8, perLevel: 2 },
  spiritPerStrike: { id: 'spiritPerStrike', name: 'Дух за удар серии', word: 'дыхания', percent: false, base: 1, perLevel: .5 },
  maxHp: { id: 'maxHp', name: 'Здоровье', word: 'крепости', percent: false, base: 10, perLevel: 4 },
  cooldownReduction: {
    id: 'cooldownReduction', name: 'Перезарядка шага и техник', word: 'ветра', percent: true, base: 6, perLevel: 1, max: 15,
  },
  hpPerKill: { id: 'hpPerKill', name: 'Здоровье за победу над монстром', word: 'жатвы', percent: false, base: 2, perLevel: .5 },
});

// strikeIndex is zero-based, like game.player.attack.index.
export const RELICS = freeze({
  'crane-neck': {
    id: 'crane-neck', name: 'Журавлиная шея', family: 'staff', strikeIndex: 2,
    wave: { radius: 3, damage: 30, spirit: 0, cracksShell: false },
  },
  'quiet-thunder': {
    id: 'quiet-thunder', name: 'Тихий гром', family: 'knuckles', strikeIndex: 3,
    chain: { targets: 2, radius: 3, damageFraction: .5 },
  },
});

// Full-clear route order of region 1. Pack ids are encounter packIds, cache ids are world.caches ids
// (`secret` is the side-path cache) and `court-ritual` is the ritual source. `side` sites are off the
// main path. The cemetery and orchard sites come last (world-expansion §6.3): the third-in-a-row rule
// looks only back, so they change no family of an older site.
export const LOOT_SITES = freeze([
  { id: 'camp-supplies', kind: 'camp', ilvl: 1, side: false },
  { id: 'road-approach', kind: 'pack', ilvl: 1, rareChance: .3, side: false },
  { id: 'road-thicket', kind: 'pack', ilvl: 1, rareChance: .3, side: true },
  { id: 'secret', kind: 'cache', ilvl: 2, side: true },
  { id: 'road-crossing', kind: 'pack', ilvl: 1, rareChance: .3, side: false },
  { id: 'road-gate', kind: 'pack', ilvl: 1, rareChance: .3, side: false },
  { id: 'court-entrance', kind: 'pack', ilvl: 2, rareChance: .5, side: false },
  { id: 'court-source', kind: 'pack', ilvl: 2, rareChance: .5, side: false },
  { id: 'court-ritual', kind: 'ritual', ilvl: 3, rareChance: 1, side: false },
  { id: 'cemetery-graves', kind: 'pack', ilvl: 2, rareChance: .5, side: true },
  { id: 'cemetery-obelisk', kind: 'pack', ilvl: 2, rareChance: .5, side: true },
  { id: 'cemetery-cache', kind: 'cache', ilvl: 3, side: true },
  { id: 'orchard-press', kind: 'pack', ilvl: 3, rareChance: .5, side: true },
  { id: 'orchard-well', kind: 'pack', ilvl: 3, rareChance: .5, side: true },
  { id: 'orchard-cache', kind: 'cache', ilvl: 3, side: true },
]);

export function affixValue(id, ilvl) {
  const affix = AFFIXES[id];
  return Math.min(affix.max ?? Infinity, affix.base + Math.floor(affix.perLevel * (ilvl - 1)));
}

// The strongest base of the family whose item level the item reaches.
export function baseFor(family, ilvl) {
  return Object.values(WEAPON_BASES)
    .filter(base => base.family === family && base.ilvl <= Math.max(1, ilvl))
    .reduce((best, base) => base.ilvl > best.ilvl ? base : best);
}

export function createItem({ id, source = id, family, ilvl = 1, rarity = 'common', affixes = [], relic = null }) {
  const rules = RARITIES[rarity];
  if (!WEAPON_FAMILIES[family] || !rules || !Number.isInteger(ilvl) || ilvl < 1) throw new Error(`Invalid item ${id}`);
  if (affixes.length !== rules.affixes || new Set(affixes).size !== affixes.length || affixes.some(affix => !AFFIXES[affix])) {
    throw new Error(`Item ${id} needs ${rules.affixes} different affixes`);
  }
  if (rules.relic !== (relic !== null) || (relic && RELICS[relic]?.family !== family)) throw new Error(`Invalid relic for item ${id}`);
  const base = baseFor(family, ilvl), values = affixes.map(affix => ({ id: affix, value: affixValue(affix, ilvl) }));
  const name = relic ? RELICS[relic].name : values.length ? `${base.name} ${AFFIXES[values[0].id].word}` : base.name;
  return freeze({ id, source, family, base: base.id, ilvl, rarity, affixes: values, relic, name });
}

// Camp supplies (E) give both common weapons at item level 1.
export function createStarterWeapons() {
  return FAMILY_IDS.map(family => createItem({ id: `camp-${family}`, source: 'camp-supplies', family }));
}

// mulberry32, private to loot so it never shifts the encounter layout stream.
function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const LOOT_SALT = 0x4c4f4f54;
const hashText = text => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
};
// Every drop site rolls from its own stream, so no site depends on how many draws another used.
const siteRandom = (seed, key) => randomFor(Math.imul(seed ^ LOOT_SALT, 0x9e3779b1) ^ hashText(key));
const rollFamily = random => random() < .5 ? 'knuckles' : 'staff';
const pickAffixes = (random, count) => {
  const pool = Object.keys(AFFIXES);
  return Array.from({ length: count }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);
};

// Rolled families must not repeat three times in a row on the main path or on a full clear.
const ROLLED_SITES = LOOT_SITES.filter(site => site.kind === 'pack' || site.kind === 'ritual');
const FAMILY_ROUTES = [ROLLED_SITES, ROLLED_SITES.filter(site => !site.side)].map(route => route.map(site => site.id));
const thirdInARow = (families, siteId, family) => FAMILY_ROUTES.some(route => {
  const index = route.indexOf(siteId);
  return index >= 2 && families[route[index - 1]] === family && families[route[index - 2]] === family;
});

// All loot is rolled once from the run seed, so claim order never changes an item.
// The cache keeps one relic per family and yields the one matching the equipped weapon.
export function rollRunLoot(seed) {
  if (!Number.isFinite(seed)) throw new TypeError('Run loot needs a numeric seed');
  seed >>>= 0;
  const drops = {}, families = {};
  for (const site of LOOT_SITES) {
    if (site.kind === 'camp') drops[site.id] = createStarterWeapons();
    else if (site.kind === 'cache') {
      const byFamily = Object.fromEntries(FAMILY_IDS.map(family => [family, createItem({
        id: `drop-${site.id}`, source: site.id, family, ilvl: site.ilvl, rarity: 'relic', relic: WEAPON_FAMILIES[family].relic,
        affixes: pickAffixes(siteRandom(seed, `${site.id}:${family}`), RARITIES.relic.affixes),
      })]));
      drops[site.id] = { fallbackFamily: rollFamily(siteRandom(seed, site.id)), byFamily };
    } else {
      const random = siteRandom(seed, site.id);
      let family = rollFamily(random);
      if (thirdInARow(families, site.id, family)) family = family === 'staff' ? 'knuckles' : 'staff';
      families[site.id] = family;
      const rarity = random() < site.rareChance ? 'rare' : 'common';
      drops[site.id] = [createItem({
        id: `drop-${site.id}`, source: site.id, family, ilvl: site.ilvl, rarity,
        affixes: pickAffixes(random, RARITIES[rarity].affixes),
      })];
    }
  }
  return freeze({ seed, drops });
}

// Items a site yields when claimed. Unarmed monks get the cache relic's seeded fallback family.
export function lootForSite(loot, siteId, equippedFamily = null) {
  const drop = loot.drops[siteId];
  if (!drop) return [];
  if (Array.isArray(drop)) return [...drop];
  return [drop.byFamily[WEAPON_FAMILIES[equippedFamily] ? equippedFamily : drop.fallbackFamily]];
}

export function createInventory() {
  return { bag: Array(ITEM_RULES.bagSize).fill(null), equipped: { weapon: null } };
}

export const isBagFull = inventory => !inventory.bag.includes(null);
const holds = (inventory, item) => [...inventory.bag, ...Object.values(inventory.equipped)].some(entry => entry?.id === item.id);

// A refused pickup leaves the item on the ground; `bag-full` shows ITEM_RULES.bagFullNotice.
export function pickUpItem(inventory, item) {
  if (holds(inventory, item)) return { ok: false, reason: 'held' };
  const slot = inventory.bag.indexOf(null);
  if (slot < 0) return { ok: false, reason: 'bag-full' };
  inventory.bag[slot] = item;
  return { ok: true, slot };
}

// The previously equipped weapon takes the chosen item's bag slot.
export function equipFromBag(inventory, slot) {
  const item = inventory.bag[slot];
  if (!item) return { ok: false, reason: 'empty' };
  const previous = inventory.equipped.weapon;
  inventory.bag[slot] = previous;
  inventory.equipped.weapon = item;
  return { ok: true, item, previous };
}

// Unequipping returns the monk to the unarmed series.
export function unequipWeapon(inventory) {
  const weapon = inventory.equipped.weapon;
  if (!weapon) return { ok: false, reason: 'empty' };
  const slot = inventory.bag.indexOf(null);
  if (slot < 0) return { ok: false, reason: 'bag-full' };
  inventory.bag[slot] = weapon;
  inventory.equipped.weapon = null;
  return { ok: true, slot };
}

// The caller places the returned item on the ground next to the monk; it can be picked up again.
export function dropFromBag(inventory, slot) {
  const item = inventory.bag[slot];
  if (!item) return { ok: false, reason: 'empty' };
  inventory.bag[slot] = null;
  return { ok: true, item };
}

export const weaponCombo = weapon => weapon ? WEAPON_FAMILIES[weapon.family].combo : UNARMED_COMBO;
export const weaponPower = weapon => weapon ? 1 + ITEM_RULES.weaponPowerPerLevel * (weapon.ilvl - 1) : 1;

// Each affix adds to the stats field named by its id; percent affixes add fractions (10 → .1).
// `equipped` is inventory.equipped, or { weapon: candidate } for a comparison card.
export function applyItemStats(stats, equipped = {}) {
  const result = { ...stats, weaponPower: weaponPower(equipped.weapon) };
  for (const id of Object.keys(AFFIXES)) result[id] = stats[id] ?? 0;
  for (const item of Object.values(equipped)) {
    for (const { id, value } of item?.affixes ?? []) result[id] += AFFIXES[id].percent ? value / 100 : value;
  }
  result.cooldownReduction = Math.min(ITEM_RULES.maxCooldownReduction, result.cooldownReduction);
  return result;
}

// Single-target series numbers for the item card and the loot line.
// damageMultiplier carries level and path bonuses; the weapon adds its power and combo affix.
export function comboStats(weapon, damageMultiplier = 1) {
  const combo = weaponCombo(weapon), stats = applyItemStats({}, { weapon });
  const scale = damageMultiplier * stats.weaponPower * (1 + stats.comboDamage);
  const damage = combo.damage.map(value => Math.round(value * scale));
  const seriesTime = Math.round(combo.duration.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const dps = Math.round(damage.reduce((sum, value) => sum + value, 0) / seriesTime);
  return { damage, seriesTime, dps, spiritPerStrike: combo.spiritPerStrike + stats.spiritPerStrike };
}
