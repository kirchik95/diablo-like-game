// The «Монах» panel (§5.5–5.9): one frame, three tabs — «Персонаж» C, «Снаряжение» I, «Умения» K.
// PanelController keeps every rule and gesture without DOM, so tests drive it directly.
// MonkPanel draws the controller's views into #monk-panel and forwards pointer and key input.
import iconPackage from '../assets/ui/pixel-v5/icons/manifest.json' with { type: 'json' };
import { appearanceVariant } from './appearance.js';
import { BEETLE_STATS, BEETLE_TIMINGS } from './campaign.js';
import { MONK_PATH, PROGRESSION_RULES, damageMultiplier, pathNodeStatus, unspentPoints, xpProgress } from './progression.js';
import {
  AFFIXES, ITEM_RULES, RARITIES, RELICS, UNARMED_COMBO, WEAPON_FAMILIES, applyItemStats, comboStats, weaponCombo, weaponPower,
} from './items.js';
import { SHELL_LABELS, SKILLS, SLOTS, TECHNIQUES, shellLabel, slotOf, techniqueParams, techniqueStatus } from './skills.js';
import { assignSkill, chooseSkillModifier, inCombat, monkStats, respecPath, skillScale, spendPathPoint } from './run-progress.js';
import { dropItem, equipItem, unequipItem } from './inventory-actions.js';
import { physicalCode } from './key-codes.js';
import { KEYBOARD_KEYS, controlKeys, slotKey } from './gamepad.js';

export const PANEL_TABS = Object.freeze(['character', 'gear', 'skills']);
export const TAB_KEYS = Object.freeze({ KeyC: 'character', KeyI: 'gear', KeyK: 'skills' });
// Over a technique row, Q and F put it into that slot (§2.9.4); RMB does it by pointer.
const KEY_SLOTS = { KeyQ: 'q', KeyF: 'f' };
const SLOT = Object.fromEntries(SLOTS.map(slot => [slot.id, slot]));
const SKILL_ORDER = ['combo', 'dash', ...TECHNIQUES];
const BRANCHES = { body: { name: 'Тело', tone: 'coral' }, spirit: { name: 'Дух', tone: 'spirit' }, strike: { name: 'Удар', tone: 'ivory' } };

const MINUS = '−';
const num = value => String(Math.round(value * 100) / 100).replace('.', ',');
const percent = fraction => Math.round(fraction * 100);
const seconds = value => `${num(value)} с`;
const units = value => `${num(value)} ед.`;
const nodeById = id => MONK_PATH.nodes.find(node => node.id === id);
const previousNode = node => MONK_PATH.nodes.find(other => other.branch === node.branch && other.row === node.row - 1) ?? null;

// Item card lines (§5.7). Affix names are shortened to fit a 132u card.
const AFFIX_LABELS = {
  comboDamage: 'Урон серии', skillDamage: 'Урон техник', spiritPerStrike: 'Дух за удар', maxHp: 'Здоровье',
  cooldownReduction: 'Перезарядка', hpPerKill: 'Здоровье за победу',
};
const LOST_LABELS = {
  comboDamage: 'урон серии', skillDamage: 'урон техник', spiritPerStrike: 'дух за удар', maxHp: 'здоровье',
  cooldownReduction: 'перезарядка', hpPerKill: 'за победу',
};
const affixAmount = (id, value) => `${id === 'cooldownReduction' ? MINUS : '+'}${value}${AFFIXES[id].percent ? '%' : ''}`;
const familySpecial = family => family === 'knuckles'
  ? ['Пробой', `${WEAPON_FAMILIES.knuckles.special.strikeIndex + 1}-й удар в спину ×${num(WEAPON_FAMILIES.knuckles.special.openShellMultiplier)}`]
  : family === 'staff' ? ['Сбивание', 'гасит снаряды духов'] : null;
const relicText = id => {
  const relic = RELICS[id];
  return relic.wave ? `${relic.strikeIndex + 1}-й удар: волна ${num(relic.wave.radius)} ед., ${relic.wave.damage} урона`
    : `${relic.strikeIndex + 1}-й удар бьёт ещё ${relic.chain.targets} цели: ${percent(relic.chain.damageFraction)}%`;
};

// Skill descriptions (§2.2–2.3): two lines at most in the 148u description column.
const SKILL_TEXT = {
  combo: () => 'Удары надетого оружия. Каждое попадание копит дух.',
  dash: () => 'Рывок сквозь врагов, урон каждому задетому. В рывке монах неуязвим.',
  wave: () => 'Круговая волна вокруг монаха. Отбрасывает стаю и раскалывает панцирь.',
  palm: p => `Дальний удар по одной цели. Ладонь летит ${num(p.speed)} ед./с на ${num(p.range)} ед. и бьёт первого монстра.`,
  crane: () => 'Прыжок к прицелу. Приземление бьёт всех в круге.',
  deflect: () => 'Стойка парирования. Удар в окно стойки отражён, монах бьёт в ответ.',
  bell: () => 'Колокол у прицела. Звон бьёт и оглушает гончих и духов.',
  mantra: () => 'Аура действует, пока мантра в слоте. Нажатие — всплеск стойкости.',
  sevenStrikes: () => 'Монах неуязвим и бьёт в спину цели у прицела.',
};
// Pause legend roles (§5.9): «волна духа: круговая волна · 40 духа».
const SKILL_ROLES = {
  wave: 'круговая волна', palm: 'дальний удар', crane: 'прыжок в бой', deflect: 'парирование',
  bell: 'ловушка', mantra: 'аура стойкости', sevenStrikes: 'удары в спину',
};
// Modifier effects (§2.6) from the resolved numbers: b is the base, m the modified skill.
// Each line fits the 134u modifier card: about 38 characters of the system font.
const MODIFIER_TEXT = {
  doubleStep: (b, m) => `${m.charges} заряда по ${seconds(m.cooldown)}. Урон ${b.damage} → ${m.damage}.`,
  crushingStep: (b, m) => `Урон ${b.damage} → ${m.damage}. Перезарядка → ${seconds(m.cooldown)}.`,
  spiritStep: (b, m) => `+${m.spiritPerHit} духа за задетого монстра, до ${m.spiritCap}.`,
  heavyWave: (b, m) => `Радиус ${num(b.radius)} → ${units(m.radius)} Урон ${b.damage} → ${m.damage}.`,
  vortexWave: (b, m) => `Тянет монстров из ${units(m.pullRadius)} Урон ${b.damage} → ${m.damage}.`,
  calmWave: (b, m) => `Лечит +${m.healPerHit} за монстра. Урон ${b.damage} → ${m.damage}.`,
  piercingPalm: (b, m) => `Сквозь монстров. Урон ${b.damage} → ${m.damage}.`,
  explodingPalm: (b, m) => `Метка ${seconds(m.markDuration)}. Гибель — взрыв ${units(m.explosionRadius)}, ${m.explosionDamage}.`,
  palmFan: (b, m) => `${m.projectiles} ладони ±${m.spreadDegrees}°, по ${m.damage}. Цена ${b.cost} → ${m.cost}.`,
  mountainFall: (b, m) => `Радиус ${num(b.radius)} → ${units(m.radius)} Урон ${b.damage} → ${m.damage}.`,
  lightCrane: (b, m) => `Цена ${b.cost} → ${m.cost}. Дальность ${num(b.range)} → ${units(m.range)}`,
  shatteringLanding: (b, m) => `Раскалывает панцирь. Урон ${b.damage} → ${m.damage}.`,
  spiritRiposte: (b, m) => `Успех даёт ${m.spiritOnSuccess} духа и сбрасывает шаг.`,
  wideStance: (b, m) => `Окно ${num(b.window)} → ${seconds(m.window)}. Ответ ${b.damage} → ${m.damage}.`,
  circularRiposte: (b, m) => `Ответ бьёт всех в ${units(m.riposteRadius)} Урон ${b.damage} → ${m.damage}.`,
  beaconBell: (b, m) => `Монстры в ${units(m.lureRadius)} идут к колоколу ${seconds(m.lureDuration)}.`,
  tripleChime: (b, m) => `${m.chimes.length} звона по ${m.damage}. Цена ${b.cost} → ${m.cost}.`,
  calmBell: (b, m) => `Звон лечит на ${m.healPerChime}. Урон ${b.damage} → ${m.damage}.`,
  retribution: (b, m) => `Ответ ${m.retaliationDamage}. Всплеск: ${m.burstDamage} и оглушение.`,
  healing: (b, m) => `Аура: +${m.auraHealPerSecond} здоровья/с. Всплеск: +${m.burstHealPerSecond}/с.`,
  clarity: (b, m) => `Аура: +${m.auraSpiritPerStrike} духа за удар. Всплеск: +${m.burstSpiritPerSecond}/с.`,
  nineStrikes: (b, m) => `${m.hits} ударов по ${m.damage}.`,
  finalStrike: (b, m) => `${m.hits}-й удар ×${m.finalHitMultiplier} и раскалывает панцирь.`,
  stunningStrikes: (b, m) => `Оглушает на ${seconds(m.stun)}. Урон ${b.damage} → ${m.damage}.`,
};

// Refusals shown in the panel, by the reason the rules return.
const PATH_REFUSALS = {
  'no-points': () => 'Нет свободных очков: очко даёт новый уровень',
  order: node => `Сначала возьми «${previousNode(node).title}»`,
  level: node => `Откроется на ур. ${MONK_PATH.rowLevels[node.row - 1]}`,
};
const SLOT_REFUSALS = {
  'slot-locked': slot => `Слот ${SLOT[slot].label} откроется на ур. ${SLOT[slot].unlockLevel}`,
  'technique-locked': (slot, skill) => `${SKILLS[skill].name} откроется на ур. ${SKILLS[skill].unlockLevel}`,
  'not-technique-slot': () => 'Серия и шаг не меняют слот',
  'not-technique': () => 'Серия и шаг не меняют слот',
};

// Pixel icons (assets/ui/pixel-v5/icons): one art pixel is one --u. The file matches --u × art scale ×
// devicePixelRatio; above 4× the 4× file is scaled up without smoothing.
const ICON_FILES = Object.fromEntries(Object.entries(iconPackage.icons).map(([name, icon]) => [name,
  Object.fromEntries(Object.entries(icon.files).map(([scale, file]) =>
    [scale, new URL(`../assets/ui/pixel-v5/icons/${file}`, import.meta.url).href]))]));
export function iconFile(name, pixels) {
  const files = ICON_FILES[name];
  if (!files) return null;
  return files[Math.max(1, Math.min(4, Math.floor(pixels + 1e-6)))];
}
export const skillIcon = (id, weapon = null) => id === 'combo' ? iconPackage.combo[weapon?.family ?? 'bare'] : iconPackage.skills[id];
export const itemIcon = item => item.relic ? iconPackage.relics[item.relic] : iconPackage.weapons[item.base];

// Pause legend rows for RMB, Q and F from the loadout (§5.9). keys are the keycaps of the device in use.
export function pauseLegend(game, keys = controlKeys(null)) {
  const level = game.progression?.level ?? 1, scale = game.progression ? skillScale(game) : undefined;
  return ['rmb', 'q', 'f'].map(slot => {
    const skill = game.loadout?.slots[slot] ?? null, locked = SLOT[slot].unlockLevel > level;
    if (locked) return { slot, locked, text: `${slot === 'q' ? 'вторая' : 'третья'} техника · откроется на ур. ${SLOT[slot].unlockLevel}` };
    if (!skill) return { slot, locked: false, empty: true, text: `пусто · ${keys.skills} — умения` };
    const params = techniqueParams(skill, game.loadout.modifiers[skill] ?? null, scale);
    return { slot, locked: false, text: `${SKILLS[skill].name.toLowerCase()}: ${SKILL_ROLES[skill]}${params.cost ? ` · ${params.cost} духа` : ''}` };
  });
}

export class PanelController {
  // keys name the controls in hints: the keyboard's, or a pad's while it is in use (gamepad.js controlKeys).
  constructor(getGame) {
    this.getGame = getGame; this.keys = controlKeys(null);
    this.reset();
  }

  // A new run starts with no «новое» marks and the «Персонаж» tab.
  reset() {
    this.isOpen = false; this.tab = 'character'; this.picked = null; this.message = null; this.firstChoice = false;
    this.focus = { character: null, gear: null, skills: null };
    this.newItems = new Set(); this.newSkills = new Set();
  }

  get game() { return this.getGame(); }

  open(tab = this.tab) {
    this.isOpen = true;
    this.show(PANEL_TABS.includes(tab) ? tab : this.tab);
    return this.tab;
  }

  close() {
    this.unmark(this.tab, this.focus[this.tab]);
    this.isOpen = false; this.picked = null; this.message = null;
  }

  show(tab) {
    if (tab !== this.tab) this.unmark(this.tab, this.focus[this.tab]);
    this.tab = tab; this.picked = null; this.message = null;
    if (tab === 'gear' && !Number.isInteger(this.focus.gear)) {
      const bag = this.game.inventory?.bag ?? [];
      const fresh = bag.findIndex(item => item && this.newItems.has(item.id));
      this.focus.gear = fresh >= 0 ? fresh : this.firstChoice ? bag.findIndex(Boolean) : null;
      if (this.focus.gear < 0) this.focus.gear = null;
    }
  }

  // Panel keys (§5.5): C, I and K open their tab and close it when it is shown; Tab cycles, Esc closes.
  // Over a technique row Q and F slot it; Delete drops the bag item under the pointer.
  // Returns what happened, or null when the key is not the panel's.
  key(code, { shift = false } = {}) {
    if (!this.isOpen) {
      if (TAB_KEYS[code]) { this.open(TAB_KEYS[code]); return 'open'; }
      if (code === 'Tab') { this.open(); return 'open'; }
      return null;
    }
    if (code === 'Escape' && this.picked) { this.picked = null; return 'cancel'; }
    if (code === 'Escape' || TAB_KEYS[code] === this.tab) { this.close(); return 'close'; }
    if (TAB_KEYS[code]) { this.show(TAB_KEYS[code]); return 'tab'; }
    if (code === 'Tab') {
      const index = PANEL_TABS.indexOf(this.tab);
      this.show(PANEL_TABS[(index + (shift ? PANEL_TABS.length - 1 : 1)) % PANEL_TABS.length]);
      return 'tab';
    }
    if (this.tab === 'skills' && KEY_SLOTS[code] && this.focus.skills) {
      this.assign(KEY_SLOTS[code], this.focus.skills);
      return 'assign';
    }
    if (this.tab === 'gear' && (code === 'Delete' || code === 'Backspace') && Number.isInteger(this.focus.gear)) {
      this.drop(this.focus.gear);
      return 'drop';
    }
    return null;
  }

  // This frame's events: picked-up items and learned techniques get the amber «новое» dot.
  observe(events) {
    for (const event of events) {
      if (event.type === 'loot-pickup' && event.item) this.newItems.add(event.item.id);
      if (event.type === 'technique-learned') this.newSkills.add(event.technique);
      if (event.type === 'supplies') this.firstChoice = true;
    }
  }

  // The dot stays while the pointer is on the thing and goes out when it leaves (§3.6, §5.8).
  unmark(tab, target) {
    if (tab === 'gear' && Number.isInteger(target)) this.newItems.delete(this.game.inventory?.bag[target]?.id);
    if (tab === 'skills' && target) this.newSkills.delete(target);
  }

  // Pointer or keyboard focus on a node, a bag cell ('weapon' for the slot) or a skill. True when it changed.
  hover(target, tab = this.tab) {
    if (this.focus[tab] === target) return false;
    this.unmark(tab, this.focus[tab]);
    this.focus[tab] = target;
    if (tab !== 'skills' || !this.picked) this.message = null;
    return true;
  }

  spend(nodeId) {
    const node = nodeById(nodeId), result = spendPathPoint(this.game, nodeId);
    this.focus.character = nodeId;
    this.message = result.ok || result.reason === 'taken' ? null : PATH_REFUSALS[result.reason]?.(node) ?? null;
    return result;
  }

  // Free and out of combat only (§4.6); in combat the view shows «Нельзя в бою» by the button.
  respec() {
    this.message = null;
    return respecPath(this.game);
  }

  // LMB on a bag item: the old weapon takes its cell (§3.6.5).
  equip(slot) {
    const item = this.game.inventory?.bag[slot] ?? null;
    if (!item) return { ok: false, reason: 'empty' };
    const result = equipItem(this.game, slot);
    if (result.ok) { this.firstChoice = false; this.newItems.delete(item.id); this.message = null; }
    return result;
  }

  // LMB on the weapon slot takes the weapon off; bare hands keep the default series (§3.7).
  unequip() {
    const result = unequipItem(this.game);
    this.message = result.ok || result.reason === 'empty' ? null : 'Сумка полна: некуда снять оружие';
    return result;
  }

  // Held RMB or Delete: the item lands next to the monk and can be picked up again (§3.6.6).
  drop(slot) {
    const item = this.game.inventory?.bag[slot] ?? null, result = dropItem(this.game, slot);
    if (result.ok) { this.newItems.delete(item.id); this.message = null; }
    return result;
  }

  // LMB on a technique row picks it; LMB on a slot then puts it there (§2.9.5).
  pick(skillId) {
    this.hover(skillId, 'skills');
    const level = this.game.progression?.level ?? 1;
    if (SKILLS[skillId].kind !== 'technique' || SKILLS[skillId].unlockLevel > level) { this.picked = null; return false; }
    this.picked = this.picked === skillId ? null : skillId;
    this.message = null;
    return !!this.picked;
  }

  clickSlot(slotId) {
    if (this.picked) return this.assign(slotId, this.picked);
    const skill = this.game.loadout?.slots[slotId];
    if (skill) this.hover(skill, 'skills');
    return null;
  }

  // Free in combat too; the changed techniques restart their cooldown (§2.8, §2.9). A technique learned
  // without a free slot enters its first slot ready (run-progress.js assignSkill).
  assign(slot, skillId) {
    const result = assignSkill(this.game, slot, skillId);
    this.picked = null;
    this.message = result.ok ? null : SLOT_REFUSALS[result.reason]?.(slot, skillId) ?? null;
    if (result.ok) this.focus.skills = skillId;
    return result;
  }

  // One modifier per skill; choosing the chosen one again clears it (§2.6).
  chooseModifier(skillId, modifierId) {
    const current = this.game.loadout?.modifiers[skillId] ?? null;
    const result = chooseSkillModifier(this.game, skillId, current === modifierId ? null : modifierId);
    this.message = result.ok ? null : result.reason === 'modifier-locked'
      ? `Модификаторы откроются на ур. ${SKILLS[skillId].modifierLevel}` : null;
    return result;
  }

  tabsView() {
    const game = this.game;
    return { tab: this.tab, points: game.progression ? unspentPoints(game.progression) : 0 };
  }

  // «Персонаж» (§5.6): portrait and level, experience, stats, the «Путь монаха» tree and respec.
  characterView() {
    const game = this.game, progression = game.progression, stats = monkStats(game);
    const weapon = game.inventory?.equipped.weapon ?? null;
    const combo = comboStats(weapon, damageMultiplier(progression, { source: 'combo' }));
    const { xp, start, next, fraction } = xpProgress(progression);
    const points = unspentPoints(progression), fighting = inCombat(game);
    const levelDamage = PROGRESSION_RULES.perLevel.damage * (progression.level - 1);
    const nodes = MONK_PATH.nodes.map(node => ({ ...node, status: pathNodeStatus(progression, node.id) }));
    const focusId = nodeById(this.focus.character)?.id ?? (nodes.find(node => node.status === 'available')
      ?? nodes.find(node => node.status !== 'taken') ?? nodes[0]).id;
    const focus = nodes.find(node => node.id === focusId), previous = previousNode(focus);
    // A touch only chooses a node; the «Взять» button spends the point (mobile-touch §12).
    const take = this.keys.touch ? '«Взять» — за 1 очко' : `${this.keys['nav:ok']} — взять за 1 очко`;
    const condition = this.message ? { text: this.message, tone: 'coral' }
      : focus.status === 'taken' ? { text: 'Взят · «Сбросить путь» вернёт очко', tone: 'dim' }
        : focus.status === 'level' ? { text: PATH_REFUSALS.level(focus), tone: 'dim' }
          : focus.status === 'order' ? { text: PATH_REFUSALS.order(focus), tone: 'dim' }
            : points < 1 ? { text: PATH_REFUSALS['no-points'](), tone: 'dim' }
              : { text: `${previous ? `${previous.title} взят · ` : ''}${take}`, tone: 'dim' };
    return {
      level: progression.level, portrait: appearanceVariant(game.appearance ?? {}).previewUrl,
      xpText: next === null ? `${xp}` : `${xp} / ${next}`,
      toNext: next === null ? 'последний' : `до ур. ${progression.level + 1} — ${next - xp}`,
      cells: next === null ? 10 : Math.min(10, Math.floor(fraction * 10 + 1e-9)), xpStart: start,
      stats: [
        { label: 'Здоровье', value: String(stats.maxHp), tone: 'coral' },
        { label: 'Дух', value: String(stats.maxSpirit), tone: 'spirit' },
        { label: 'Серия, урон/с, 1 цель', value: String(combo.dps), tone: 'ivory' },
        { label: 'Мощь оружия', value: `${percent(stats.weaponPower)}%`, tone: 'ivory' },
        { label: 'Урон уровня', value: `+${percent(levelDamage)}%`, tone: levelDamage ? 'ivory' : 'dim' },
        { label: 'Дух за удар', value: String(combo.spiritPerStrike), tone: 'ivory' },
        { label: 'Перезарядка умений', value: `${MINUS}${percent(stats.cooldownReduction)}%`, tone: stats.cooldownReduction ? 'ivory' : 'dim' },
        { label: 'Здоровье за победу', value: `+${stats.hpPerKill}`, tone: stats.hpPerKill ? 'ivory' : 'dim' },
        { label: 'Получаемый урон', value: `${MINUS}${percent(1 - stats.damageTaken)}%`, tone: stats.damageTaken < 1 ? 'ivory' : 'dim' },
        { label: 'Побеждено за путь', value: String(game.adventure?.totalKills ?? game.kills ?? 0), tone: 'amber' },
      ],
      rows: MONK_PATH.rowLevels.map(level => ({ level, open: progression.level >= level })),
      nodes, links: nodes.filter(node => node.row > 1).map(node => ({
        branch: node.branch, row: node.row - 1, lit: progression.path.includes(previousNode(node).id),
      })),
      focus: { ...focus, branchName: BRANCHES[focus.branch].name, tone: BRANCHES[focus.branch].tone, condition },
      points, respec: { enabled: !fighting && progression.path.length > 0, inCombat: fighting },
      take: focus.status === 'available' && points > 0 ? focus.id : null,
    };
  }

  // One comparison card (§5.7): rows 1–9 for an item, or the bare-handed series.
  // against is the equipped weapon when this card is the chosen one.
  itemCard(item, against = undefined) {
    const game = this.game, scale = damageMultiplier(game.progression, { source: 'combo' });
    const combo = weaponCombo(item), stats = comboStats(item, scale), rarity = RARITIES[item?.rarity] ?? RARITIES.common;
    const arc = Math.max(...combo.arc), compare = against !== undefined;
    const otherFamily = compare && !!item && !!against && against.family !== item.family;
    const card = {
      name: item ? item.name : 'Без оружия', color: item ? rarity.color : '--ivory', gems: item ? rarity.gems : 0,
      rarity: item?.rarity ?? 'none', icon: item ? itemIcon(item) : null,
      family: item ? `${WEAPON_FAMILIES[item.family].name} · УП ${item.ilvl} · мощь ${percent(weaponPower(item))}%`
        : 'Серия по умолчанию · мощь 100%',
      dps: stats.dps, strikes: stats.damage.join(' / '), spirit: `· дух ${stats.spiritPerStrike}`,
      rhythm: `${seconds(stats.seriesTime)} · ${num(Math.min(...combo.range))}–${units(Math.max(...combo.range))} · ${arc >= 180 ? '360°' : `±${arc}°`}`,
      special: familySpecial(item?.family), affixes: [], trailing: null, delta: null,
    };
    if (compare) {
      const gain = stats.dps - comboStats(against ?? null, scale).dps;
      card.delta = { text: gain ? `${gain > 0 ? '▲' : '▼'} ${Math.abs(gain)}` : '= как надето',
        tone: otherFamily || !gain ? 'muted' : gain > 0 ? 'better' : 'worse' };
    }
    for (const { id, value } of item?.affixes ?? []) {
      const entry = { text: `${AFFIX_LABELS[id]} ${affixAmount(id, value)}`, compare: null };
      if (compare) {
        const held = against?.affixes.find(affix => affix.id === id)?.value;
        const unit = AFFIXES[id].percent ? '%' : '';
        entry.compare = held === undefined ? { text: '▲ новое', tone: 'better' }
          : value > held ? { text: `▲ ${value - held}${unit}`, tone: 'better' }
            : value < held ? { text: `▼ ${held - value}${unit}`, tone: 'worse' } : { text: '= надето', tone: 'muted' };
      }
      card.affixes.push(entry);
    }
    const lost = compare ? (against?.affixes ?? []).filter(affix => !item?.affixes.some(own => own.id === affix.id)) : [];
    card.trailing = item?.relic ? { text: relicText(item.relic), tone: 'amber' }
      // §5.7 says «меняет серию и ритм»; the shorter line fits a 132u card in every system font.
      : otherFamily ? { text: 'Другое оружие: иная серия и ритм', tone: 'muted', plain: true }
        : lost.length ? { text: `Теряешь: ${lost.map(affix => LOST_LABELS[affix.id]).join(', ')}`, tone: 'coral' }
          : null;
    return card;
  }

  // «Снаряжение» (§5.7): weapon slot, future slots, bag 4 × 2, «Если надеть», two cards and the hint.
  gearView() {
    const game = this.game, inventory = game.inventory, equipped = inventory.equipped.weapon;
    const scale = damageMultiplier(game.progression, { source: 'combo' });
    const focus = this.focus.gear, selected = Number.isInteger(focus) ? inventory.bag[focus] ?? null : null;
    const touch = !!this.keys.touch, filled = inventory.bag.filter(Boolean).length;
    const current = { dps: comboStats(equipped, scale).dps, power: weaponPower(equipped), spirit: comboStats(equipped, scale).spiritPerStrike,
      ...applyItemStats({}, { weapon: equipped }) };
    const next = selected && { dps: comboStats(selected, scale).dps, power: weaponPower(selected),
      spirit: comboStats(selected, scale).spiritPerStrike, ...applyItemStats({}, { weapon: selected }) };
    const row = (label, key, format) => {
      const before = current[key], after = next ? next[key] : before;
      return { label, value: format(after) + (after > before ? ' ▲' : after < before ? ' ▼' : ''),
        tone: after > before ? 'better' : after < before ? 'worse' : 'ivory' };
    };
    return {
      weapon: equipped ? {
        icon: itemIcon(equipped), rarity: equipped.rarity, color: RARITIES[equipped.rarity].color, gems: RARITIES[equipped.rarity].gems,
        family: WEAPON_FAMILIES[equipped.family].name, line: `УП ${equipped.ilvl} · ${current.dps}/с`,
      } : { icon: null, family: 'Без оружия', line: `серия ${UNARMED_COMBO.damage.join(' / ')}` },
      count: `${filled} / ${inventory.bag.length}`, full: filled === inventory.bag.length,
      cells: inventory.bag.map((item, slot) => item ? {
        slot, item, icon: itemIcon(item), rarity: item.rarity, color: RARITIES[item.rarity].color, gems: RARITIES[item.rarity].gems,
        isNew: this.newItems.has(item.id), selected: focus === slot,
      } : { slot, item: null, selected: focus === slot }),
      summary: [
        row('Урон/с', 'dps', String),
        row('Мощь', 'power', value => `${percent(value)}%`),
        row('Дух за удар', 'spirit', String),
        row('Перезарядка', 'cooldownReduction', value => `${MINUS}${percent(value)}%`),
        row('За победу', 'hpPerKill', String),
      ],
      equippedLabel: equipped ? 'оружие вне сумки' : 'слот пуст',
      equippedCard: this.itemCard(equipped),
      chosen: selected ? { label: 'Выбрано', isNew: this.newItems.has(selected.id), cell: `ячейка ${focus + 1}`, card: this.itemCard(selected, equipped) }
        // A touch on the weapon slot shows the worn weapon with «Снять».
        : touch && focus === 'weapon' && equipped ? { label: 'Надето', cell: 'оружие', card: this.itemCard(equipped), worn: true }
          : Number.isInteger(focus) ? { label: touch ? 'Выбрано' : 'Наведено', cell: `ячейка ${focus + 1}`, empty: true, count: `Сумка ${filled} / ${inventory.bag.length}` }
            : { label: 'Выбрано', cell: '', placeholder: true, count: `Сумка ${filled} / ${inventory.bag.length}` },
      firstChoice: this.firstChoice && !equipped && filled > 0,
      message: this.tab === 'gear' ? this.message : null,
    };
  }

  // Cast numbers of the four table columns (§5.8.4).
  skillNumbers(id, params) {
    const game = this.game, weapon = game.inventory?.equipped.weapon ?? null;
    const cost = { label: 'Дух', value: params.cost ? `${MINUS}${params.cost}` : '0', tone: 'spirit' };
    const cooldown = { label: 'Перезарядка', value: params.cooldown ? seconds(params.cooldown) : '—' };
    const damage = value => ({ label: 'Урон', value: String(value) });
    switch (id) {
      case 'combo': {
        const combo = weaponCombo(weapon), stats = comboStats(weapon, damageMultiplier(game.progression, { source: 'combo' }));
        return [{ label: 'Дух', value: `+${stats.spiritPerStrike}`, tone: 'spirit' }, { label: 'Серия', value: seconds(stats.seriesTime) },
          { label: 'Урон/с', value: String(stats.dps) },
          { label: 'Дальность', value: `${num(Math.min(...combo.range))}–${units(Math.max(...combo.range))}` }];
      }
      case 'dash': return [{ ...cost, value: params.spiritPerHit ? `+${params.spiritPerHit}` : '0' },
        { ...cooldown, value: params.charges > 1 ? `${params.charges} × ${seconds(params.cooldown)}` : cooldown.value },
        damage(params.damage), { label: 'Рывок', value: units(params.speed * params.duration) }];
      case 'wave': return [cost, cooldown, damage(params.damage), { label: 'Радиус', value: units(params.radius) }];
      case 'palm': return [cost, cooldown, damage(params.projectiles > 1 ? `${params.projectiles} × ${params.damage}` : params.damage),
        { label: 'Дальность', value: units(params.range) }];
      case 'crane': return [cost, cooldown, damage(params.damage), { label: 'Прыжок', value: units(params.range) }];
      case 'deflect': return [{ ...cost, value: `+${params.spiritOnSuccess}` }, cooldown, damage(params.damage),
        { label: 'Окно', value: seconds(params.window) }];
      case 'bell': return [cost, cooldown, damage(`${params.chimes.length} × ${params.damage}`), { label: 'Радиус', value: units(params.radius) }];
      case 'mantra': return [cost, cooldown, damage(params.burstDamage || '—'),
        { label: 'Аура', value: params.auraDamageReduction ? `${MINUS}${percent(params.auraDamageReduction)}%` : 'в слоте' }];
      default: return [cost, cooldown, damage(`${params.hits} × ${params.damage}`), { label: 'Зона', value: units(params.radius) }];
    }
  }

  // «Умения» (§5.8): the slot row, the skill list, the description, numbers, shell tag and modifiers.
  skillsView() {
    const game = this.game, level = game.progression.level, loadout = game.loadout, scale = skillScale(game);
    const weapon = game.inventory?.equipped.weapon ?? null;
    const focusId = SKILLS[this.focus.skills] ? this.focus.skills
      : [...this.newSkills].find(id => SKILLS[id]) ?? loadout.slots.rmb ?? 'combo';
    const statusOf = id => id === 'combo' || id === 'dash' ? 'slotted' : techniqueStatus(loadout, id, level);
    const rows = SKILL_ORDER.map(id => {
      const entry = SKILLS[id], status = statusOf(id), slot = slotOf(loadout, id);
      const params = id === 'combo' ? null : techniqueParams(id, loadout.modifiers[id] ?? null, scale);
      return {
        id, name: entry.name, status, slot, key: slot ? slotKey(this.keys, slot) : null, icon: skillIcon(id, weapon),
        cost: id === 'combo' ? `+${comboStats(weapon).spiritPerStrike}` : params.cost ? String(params.cost) : '',
        costTone: id === 'combo' ? 'gain' : 'spirit', unlockLevel: entry.unlockLevel,
        isNew: this.newSkills.has(id), selected: focusId === id, picked: this.picked === id,
      };
    });
    const entry = SKILLS[focusId], focus = rows.find(row => row.id === focusId);
    const modifierId = loadout.modifiers[focusId] ?? null;
    const params = techniqueParams(focusId, focusId === 'combo' ? null : modifierId, scale);
    const base = focusId === 'combo' ? params : techniqueParams(focusId, null, scale);
    const shell = shellLabel(params);
    const shellNote = shell === 'break'
      ? params.shellBreak === 'deflectedSlam' ? 'при отражении' : params.shellBreak === 'finalStrike' ? 'последний удар'
        : `открыт ${seconds(BEETLE_TIMINGS.exposed)}`
      : shell === 'full' ? 'без блока' : `${percent(BEETLE_STATS.blockDamage)}% урона`;
    const kind = entry.kind === 'combo' ? `серия · ${this.keys.attack}` : entry.kind === 'dash' ? `шаг · ${this.keys.dash}`
      : focus.status === 'locked' ? `ур. ${entry.unlockLevel}` : focus.slot ? `техника · ${slotKey(this.keys, focus.slot)}` : 'техника';
    return {
      slots: SLOTS.map(slot => {
        const skill = loadout.slots[slot.id] ?? null, locked = slot.unlockLevel > level;
        const slotParams = skill && slot.id !== 'lmb' ? techniqueParams(skill, loadout.modifiers[skill] ?? null, scale) : null;
        return { id: slot.id, label: slotKey(this.keys, slot.id), skill, locked, unlockLevel: slot.unlockLevel, fixed: slot.accepts === 'combo',
          cost: slotParams?.cost ? String(slotParams.cost) : '', selected: !!skill && skill === focusId,
          target: !!this.picked && slot.accepts === 'technique' && !locked, isNew: !!skill && this.newSkills.has(skill),
          strikes: slot.id === 'lmb' ? weaponCombo(weapon).strikes : 0 };
      }),
      rows, picked: this.picked ? SKILLS[this.picked].name : null,
      message: this.tab === 'skills' ? this.message : null,
      detail: {
        id: focusId, name: entry.name, kind, status: focus.status, locked: focus.status === 'locked',
        unslotted: focus.status === 'unslotted', text: SKILL_TEXT[focusId](params),
        numbers: this.skillNumbers(focusId, params), shell: SHELL_LABELS[shell], shellNote,
        modifierLevel: entry.modifierLevel,
        modifiers: entry.modifiers.map(modifier => ({
          id: modifier.id, name: modifier.name, selected: modifierId === modifier.id, locked: entry.modifierLevel > level,
          text: MODIFIER_TEXT[modifier.id](base, techniqueParams(focusId, modifier.id, scale)),
        })),
      },
    };
  }
}

// ── DOM ────────────────────────────────────────────────────────────────────────────────────

// The document the panel draws into; MonkPanel sets it, so the module loads without a DOM.
let dom = globalThis.document;
function h(tag, props = {}, ...children) {
  const element = dom.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'vars') for (const [name, v] of Object.entries(value)) element.style.setProperty(`--${name}`, v);
    else element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child != null && child !== false));
  return element;
}
const svg = (className, viewBox, body) => {
  const holder = dom.createElement('span');
  holder.innerHTML = `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${body}</svg>`;
  return holder.firstChild;
};
const use = (className, viewBox, id) => svg(className, viewBox, `<use href="#${id}" />`);
// Rarity stones (§3.4): 3×3u squares, coloured by the rarity class of the cell or card.
const gems = count => count ? h('span', { class: 'mp-gems' }, ...Array.from({ length: count }, () => h('i'))) : null;
const newMark = () => use('mp-new', '0 0 5 5', 'mark-new');
const kbd = (text, className = '') => h('kbd', { class: className, text });

// Node icons on a 5×5 grid, one per branch, with a light pixel.
const NODE_ICONS = {
  body: ['M1 0h1v1h1V0h1v1h1v2H4v1H3v1H2V4H1V3H0V1h1z', 'M1 1h1v1H1z'],
  spirit: ['M2 0h1v1h1v1h1v1H4v1H3v1H2V4H1V3H0V2h1V1h1z', 'M2 1h1v1H2z'],
  strike: ['M1 0h3v1h1v2H4v1H3v1H1V4H0V1h1z', 'M2 1h1v1H2z'],
};

export class MonkPanel {
  // root is #monk-panel. onClose runs when the panel asks to close (the Esc keycap or the backdrop).
  constructor(root, { getGame, onClose = () => {}, doc = globalThis.document } = {}) {
    this.root = root; this.onClose = onClose; this.doc = dom = doc;
    this.controller = new PanelController(getGame);
    this.content = doc.getElementById('monk-content');
    this.hold = null; this.pending = 0; this.pendingFocus = null;
    root.addEventListener('click', event => this.click(event));
    root.addEventListener('pointerover', event => this.over(event));
    root.addEventListener('focusin', event => this.over(event));
    root.addEventListener('pointerdown', event => this.press(event));
    // Touch keeps implicit capture on the button, so pointerleave alone cannot cancel a drag off it.
    root.addEventListener('pointermove', event => {
      const hold = this.hold;
      if (hold?.pointerId == null || event.pointerId !== hold.pointerId) return;
      const rect = hold.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.release();
    });
    for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, event => {
      if (this.hold?.pointerId == null || event.pointerId === this.hold.pointerId) this.release();
    });
    // pointerleave does not bubble; the capture phase still sees the held cell lose the pointer.
    root.addEventListener('pointerleave', event => {
      const hold = this.hold;
      if (hold && event.target === hold.target && (hold.pointerId == null || event.pointerId === hold.pointerId)) this.release();
    }, true);
    root.addEventListener('contextmenu', event => event.preventDefault());
  }

  get isOpen() { return this.controller.isOpen; }
  get tab() { return this.controller.tab; }

  reset() { this.release(); this.controller.reset(); this.root.hidden = true; }
  observe(events) { this.controller.observe(events); }

  // The keycaps of the device in use (gamepad.js controlKeys). An open panel redraws with them and keeps the focus.
  setKeys(keys) {
    if (this.controller.keys === keys) return;
    this.controller.keys = keys;
    if (this.isOpen) this.render(this.content.contains(this.doc.activeElement) ? this.doc.activeElement : null);
  }

  // The dialog takes the focus, so keys reach the panel without a focus ring on a tab.
  open(tab) {
    this.controller.open(tab);
    this.root.hidden = false;
    this.render();
    this.doc.getElementById('monk-dialog')?.focus({ preventScroll: true });
  }

  close() {
    this.release();
    this.controller.close();
    this.root.hidden = true;
  }

  // A key event while the panel is open, by physical key in any layout. Returns what happened,
  // or null when the key is not the panel's.
  key(event) {
    const result = this.controller.key(physicalCode(event), { shift: !!event.shiftKey });
    if (result === 'close') this.close();
    else if (result) {
      // A tab switch or a slot change ends a running drop hold: its bag cell is redrawn away.
      this.release();
      // A redraw drops the focused control; the dialog keeps the keys.
      const kept = this.content.contains(this.doc.activeElement);
      this.render();
      if (kept || result === 'tab') this.doc.getElementById('monk-dialog')?.focus({ preventScroll: true });
    }
    return result;
  }

  // Arrow keys move the focus through the controls of the shown tab.
  moveFocus(step) {
    const items = [...this.content.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const index = items.indexOf(this.doc.activeElement);
    items[(index + step + items.length) % items.length].focus({ preventScroll: true });
  }

  target(event) {
    return event.target?.closest?.('[data-tab], [data-node], [data-take], [data-respec], [data-bag], [data-weapon], [data-equip], [data-unequip], [data-skill], [data-slot], [data-modifier], [data-close], .monk-backdrop') ?? null;
  }

  // With the touch labels (gamepad.js TOUCH_KEYS) a node, a bag cell or the weapon slot is only chosen;
  // «Взять», «Надеть», «Снять» and «Держи — выбросить» act (mobile-touch §12).
  click(event) {
    const target = this.target(event), c = this.controller, touch = !!c.keys.touch;
    if (!target) return;
    const { dataset } = target;
    // A tap or ✕ (A) acts on the panel, so a running drop hold (□ / X on the pad) ends first.
    this.release();
    if (target.classList.contains('monk-backdrop') || dataset.close !== undefined) { this.onClose(); return; }
    if (dataset.tab) { if (dataset.tab !== c.tab) { c.show(dataset.tab); this.render(); } return; }
    if (dataset.node) { if (touch) c.hover(dataset.node); else c.spend(dataset.node); }
    else if (dataset.take) c.spend(dataset.take);
    else if (dataset.respec !== undefined) c.respec();
    else if (dataset.bag !== undefined) { if (touch) c.hover(Number(dataset.bag)); else c.equip(Number(dataset.bag)); }
    else if (dataset.equip !== undefined) c.equip(Number(dataset.equip));
    else if (dataset.weapon !== undefined) { if (touch) c.hover('weapon'); else c.unequip(); }
    else if (dataset.unequip !== undefined) c.unequip();
    else if (dataset.skill) c.pick(dataset.skill);
    else if (dataset.slot) c.clickSlot(dataset.slot);
    else if (dataset.modifier) c.chooseModifier(dataset.owner, dataset.modifier);
    else return;
    this.render(target);
  }

  // A finger never hovers: on the phone the first touch chooses (click).
  over(event) {
    if (this.controller.keys.touch) return;
    const target = this.target(event), { dataset = {} } = target ?? {};
    const focus = dataset.node ?? (dataset.bag !== undefined ? Number(dataset.bag) : undefined)
      ?? (dataset.weapon !== undefined ? 'weapon' : undefined) ?? dataset.skill;
    if (focus !== undefined && this.controller.hover(focus)) this.renderSoon(target);
  }

  // Hover redraws wait for the next frame, so the control under the pointer is never replaced inside its own event.
  renderSoon(focused) {
    this.pendingFocus = focused;
    this.pending ||= requestAnimationFrame(() => { this.pending = 0; this.render(this.pendingFocus); });
  }

  // Held RMB on a bag item drops it (holdDrop); RMB on a technique row puts it into the RMB slot.
  // A finger held on «Держи — выбросить» drops the chosen item the same way.
  press(event) {
    const drop = event.target?.closest?.('[data-drop]');
    if (drop && event.button === 0) {
      event.preventDefault();
      this.holdDrop(drop, event.pointerType === 'touch' ? event.pointerId : null);
      return;
    }
    if (event.button !== 2) return;
    const target = this.target(event);
    if (!target) return;
    event.preventDefault();
    if (target.dataset.skill) {
      this.controller.hover(target.dataset.skill);
      this.controller.assign('rmb', target.dataset.skill);
      this.render(target);
    } else this.holdDrop(target);
  }

  // A bag item held for ITEM_RULES.dropHoldTime (RMB, □ / X on the pad, or a finger on «Держи — выбросить»)
  // drops; release() before that keeps it. Returns true when a hold started.
  holdDrop(target, pointerId = null) {
    const cell = target?.dataset?.bag ?? target?.dataset?.drop;
    if (cell === undefined || target.classList.contains('empty')) return false;
    this.release();
    const slot = Number(cell);
    target.classList.add('holding');
    this.hold = { target, pointerId, timer: setTimeout(() => {
      this.hold = null;
      target.classList.remove('holding');
      this.controller.drop(slot);
      this.render(target);
    }, ITEM_RULES.dropHoldTime * 1000) };
    return true;
  }

  release() {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold.target.classList.remove('holding');
    this.hold = null;
  }

  // Redraws the tab strip and the shown tab. A redraw keeps keyboard focus on the same control.
  render(focused = null) {
    if (this.pending) { cancelAnimationFrame(this.pending); this.pending = 0; }
    if (!this.isOpen) return;
    const tabs = this.controller.tabsView();
    for (const tab of PANEL_TABS) {
      const button = this.doc.getElementById(`monk-tab-${tab}`);
      button.classList.toggle('active', tab === tabs.tab);
      button.setAttribute('aria-selected', String(tab === tabs.tab));
      button.tabIndex = tab === tabs.tab ? 0 : -1;
    }
    const points = this.doc.getElementById('monk-tab-points');
    points.hidden = tabs.points < 1;
    points.textContent = `+${tabs.points}`;
    this.content.className = `monk-content tab-${tabs.tab}`;
    this.content.setAttribute('aria-labelledby', `monk-tab-${tabs.tab}`);
    const restore = focused && this.doc.activeElement === focused ? selectorOf(focused) : null;
    this.content.replaceChildren(...(tabs.tab === 'character' ? this.character() : tabs.tab === 'gear' ? this.gear() : this.skills()));
    if (restore) this.content.querySelector(restore)?.focus({ preventScroll: true });
  }

  icon(name, artScale = 1, className = 'mp-icon') {
    if (!name) return null;
    const unit = parseFloat(getComputedStyle(this.doc.documentElement).getPropertyValue('--u')) || 2;
    return h('img', { class: className, src: iconFile(name, unit * artScale * (window.devicePixelRatio || 1)), alt: '', draggable: 'false' });
  }

  character() {
    const v = this.controller.characterView(), focus = v.focus;
    const portrait = h('div', { class: 'mp-portrait' },
      h('img', { src: v.portrait, alt: '', draggable: 'false' }),
      h('span', { class: 'mp-level-badge', text: String(v.level) }));
    const monk = h('div', { class: 'mp-monk' },
      h('div', { class: 'mp-portrait-row' }, portrait, h('div', { class: 'mp-level' },
        h('span', { class: 't-muted', text: 'Уровень' }), h('strong', { text: String(v.level) }), h('span', { class: 't-dim', text: v.toNext }))),
      h('div', { class: 'mp-xp' },
        h('div', { class: 'mp-line' }, h('span', { class: 't-muted', text: 'Опыт' }), h('span', { class: 't-amber', text: v.xpText })),
        h('div', { class: 'mp-xp-cells', role: 'progressbar', 'aria-label': 'Опыт уровня', 'aria-valuetext': v.xpText },
          ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < v.cells ? 'on' : null })))),
      h('dl', { class: 'mp-stats' }, ...v.stats.map(stat => h('div', { class: 'mp-line' },
        h('dt', { class: 't-muted', text: stat.label }), h('dd', { class: `t-${stat.tone}`, text: stat.value })))));
    // Branch columns 51u apart; rows 23u apart (20u node, 3u link), so the description has room for a two-line effect.
    const columns = { body: 23, spirit: 74, strike: 125 };
    const tree = h('div', { class: 'mp-tree' },
      ...Object.entries(BRANCHES).map(([branch, { name, tone }]) => h('span', { class: `mp-branch t-${tone}`, text: name,
        vars: { x: columns[branch] } })),
      ...v.rows.map((row, i) => h('span', { class: `mp-row-level ${row.open ? 't-muted' : 't-dim'}`, text: `ур. ${row.level}`,
        vars: { y: 11 + 23 * i } })),
      ...v.links.map(link => h('i', { class: `mp-link${link.lit ? ' lit' : ''}`, vars: { x: columns[link.branch] + 14, y: 8 + 23 * link.row } })),
      ...v.nodes.map(node => {
        const [shape, light] = NODE_ICONS[node.branch];
        const button = h('button', { type: 'button', class: `mp-node ${node.branch} ${node.status}${node.id === focus.id ? ' focus' : ''}`,
          'data-node': node.id, 'aria-label': `${node.title}: ${node.text}`, vars: { x: columns[node.branch] + 5, y: 11 + 23 * (node.row - 1) } },
        svg('mp-node-icon', '0 0 5 5', `<path class="shape" d="${shape}" /><path class="light" d="${light}" />`));
        return button;
      }));
    const description = h('div', { class: `mp-node-info`, vars: { branch: `var(--${focus.tone})` } },
      h('div', { class: 'mp-line' }, h('span', { class: 't-ivory', text: focus.title }), h('span', { class: `t-${focus.tone}`, text: `${focus.branchName} · ряд ${focus.row}` })),
      h('span', { class: 'mp-node-effect t-muted', text: `${focus.text}.` }),
      h('span', { class: `t-${focus.condition.tone}`, text: focus.condition.text }));
    const respec = h('div', { class: 'mp-respec' },
      h('span', { class: 't-muted', text: 'Очки пути:' }), h('b', { class: `mp-points${v.points ? '' : ' none'}`, text: String(v.points) }),
      h('span', { class: 'mp-spacer' }),
      v.respec.inCombat ? h('span', { class: 't-coral', text: 'Нельзя в бою' }) : null,
      this.controller.keys.touch && v.take ? h('button', { type: 'button', class: 'mp-button mp-take', 'data-take': v.take, text: 'Взять' }) : null,
      h('button', { type: 'button', class: 'mp-button', 'data-respec': true, disabled: !v.respec.enabled, text: 'Сбросить путь' }));
    const path = h('div', { class: 'mp-path' },
      h('div', { class: 'mp-line' }, h('span', { class: 't-ivory', text: 'Путь монаха' }), h('span', { class: 't-dim', text: 'узлы ветви — по порядку' })),
      tree, description, respec);
    return [monk, path];
  }

  card(card, extra = null) {
    return h('div', { class: `mp-card rarity-${card.rarity}${extra ? ` ${extra}` : ''}` },
      h('div', { class: 'mp-card-row' }, h('span', { class: 'mp-name', text: card.name, vars: { rarity: `var(${card.color})` } }), gems(card.gems)),
      h('div', { class: 'mp-card-row t-muted', text: card.family }),
      h('div', { class: 'mp-card-row mp-dps' }, h('strong', { text: String(card.dps) }), h('span', { class: 'mp-shrink t-muted', text: 'урона/с · одна цель' }),
        h('span', { class: 'mp-spacer' }), card.delta ? h('span', { class: `t-${card.delta.tone}`, text: card.delta.text }) : null),
      h('div', { class: 'mp-card-row' }, h('span', { class: 'mp-lane t-dim', text: 'Удары' }), h('span', { class: 't-ivory', text: card.strikes }),
        h('span', { class: 'mp-card-spirit t-spirit', text: card.spirit })),
      h('div', { class: 'mp-card-row' }, h('span', { class: 'mp-lane t-dim', text: 'Серия' }), h('span', { class: 't-muted', text: card.rhythm })),
      card.special ? h('div', { class: 'mp-card-row' }, h('span', { class: 't-ivory', text: card.special[0] }), h('span', { class: 't-muted', text: card.special[1] }))
        : h('div', { class: 'mp-card-row t-dim', text: '— особенности нет' }),
      ...card.affixes.map(affix => h('div', { class: 'mp-card-row mp-affix' }, h('i'), h('span', { class: 'mp-shrink t-ivory', text: affix.text }),
        h('span', { class: 'mp-spacer' }), affix.compare ? h('span', { class: `t-${affix.compare.tone}`, text: affix.compare.text }) : null)),
      card.trailing ? h('div', { class: `mp-card-row ${card.trailing.plain ? '' : 'mp-affix '}t-${card.trailing.tone}` },
        card.trailing.plain ? null : h('i'), h('span', { class: 'mp-shrink', text: card.trailing.text })) : null);
  }

  gear() {
    const v = this.controller.gearView(), k = this.controller.keys, touch = !!k.touch;
    const lockedSlots = [['beads', 'Чётки'], ['robe', 'Одеяние'], ['belt', 'Пояс'], ['wraps', 'Обмотки']];
    const weaponCell = h('button', { type: 'button', class: `mp-weapon rarity-${v.weapon.rarity ?? 'none'}${this.controller.focus.gear === 'weapon' ? ' selected' : ''}`,
      'data-weapon': true, 'aria-label': v.weapon.icon ? `Оружие: ${v.weapon.family}${touch ? '' : `. ${k['nav:ok']} — снять`}` : 'Оружие: без оружия' },
    this.icon(v.weapon.icon, 2, 'mp-icon x2'), v.weapon.icon ? gems(v.weapon.gems) : null);
    const weaponRow = h('div', { class: 'mp-weapon-row' }, weaponCell, h('div', { class: 'mp-weapon-text' },
      h('span', { class: 't-dim', text: 'Оружие' }),
      h('span', { text: v.weapon.family, class: v.weapon.icon ? 'mp-name' : 't-muted', vars: v.weapon.icon ? { rarity: `var(${v.weapon.color})` } : null }),
      h('span', { class: 't-muted', text: v.weapon.line })));
    const future = h('div', { class: 'mp-future', role: 'list', 'aria-label': 'Будущие слоты: откроются в следующих регионах' },
      ...lockedSlots.map(([id, name]) => h('span', { class: 'mp-future-slot', role: 'listitem', title: `${name} · откроется в следующих регионах` },
        use('mp-future-icon', '0 0 18 18', `gear-${id}`))));
    const bag = h('div', { class: 'mp-bag' },
      h('div', { class: 'mp-line mp-head' }, h('span', { class: 't-muted', text: 'Сумка' }), h('span', { class: v.full ? 't-coral' : 't-ivory', text: v.count })),
      h('div', { class: 'mp-cells' }, ...v.cells.map(cell => cell.item
        ? h('button', { type: 'button', class: `mp-cell rarity-${cell.rarity}${cell.selected ? ' selected' : ''}`, 'data-bag': cell.slot,
          'aria-label': touch ? cell.item.name : `${cell.item.name}. ${k['nav:ok']} — надеть, держи ${k.drop} — выбросить` },
        this.icon(cell.icon), gems(cell.gems), cell.isNew ? newMark() : null)
        : h('button', { type: 'button', class: `mp-cell empty${cell.selected ? ' selected' : ''}`, 'data-bag': cell.slot, 'aria-label': `Ячейка ${cell.slot + 1}: пусто` }))));
    const summary = h('div', { class: 'mp-summary' },
      h('div', { class: 'mp-head t-muted', text: 'Если надеть' }),
      h('dl', {}, ...v.summary.map(row => h('div', { class: 'mp-line' }, h('dt', { class: 't-dim', text: row.label }),
        h('dd', { class: `t-${row.tone}`, text: row.value })))));
    const chosen = v.chosen;
    const labels = h('div', { class: 'mp-card-labels' },
      h('div', { class: 'mp-line' }, h('span', { class: 't-muted', text: 'Надето' }), h('span', { class: 't-dim', text: v.equippedLabel })),
      h('div', { class: 'mp-line' }, h('span', { class: 't-muted', text: chosen.label }), chosen.isNew ? h('span', { class: 't-amber mp-fresh', text: 'новое' }) : null,
        h('span', { class: 'mp-spacer' }), h('span', { class: 't-dim', text: chosen.cell })));
    const right = chosen.card ? this.card(chosen.card, 'chosen')
      : h('div', { class: 'mp-card mp-card-empty mp-dashed' },
        h('span', { class: 't-ivory', text: chosen.empty ? 'Пустое место' : touch ? 'Выбери предмет в сумке' : 'Наведи на предмет в сумке' }),
        h('span', { class: 't-muted', text: chosen.empty ? 'Наступи на предмет на земле — он ляжет сюда' : 'Здесь появится сравнение с надетым' }),
        h('span', { class: 't-dim', text: chosen.count }));
    const hint = v.message ? h('div', { class: 'mp-hint t-coral', text: v.message })
      : v.firstChoice ? h('div', { class: 'mp-hint' }, h('span', { class: 't-amber', text: 'Выбери оружие:' }), kbd(k['nav:ok']), h('span', { class: 't-amber', text: '— надеть' }))
        : h('div', { class: 'mp-hint' }, kbd(k['nav:ok']), h('span', { class: 't-muted', text: 'надеть' }), h('span', { class: 't-stone', text: '·' }),
          h('span', { class: 't-muted', text: 'держи' }), kbd(k.drop), h('span', { class: 't-muted', text: '— выбросить' }), h('span', { class: 'mp-spacer' }),
          use('mp-lock', '0 0 6 7', 'lock-hint'), h('span', { class: 't-dim', text: 'в следующих регионах' }));
    if (touch) return this.touchGear(v, [weaponRow, bag, future], summary, right);
    return [h('div', { class: 'mp-gear-top' }, h('div', { class: 'mp-equipment' }, weaponRow, future), bag, summary),
      h('div', { class: 'mp-compare' }, labels, h('div', { class: 'mp-cards' }, this.card(v.equippedCard, 'equipped'), right)), hint];
  }

  // The phone sheet (mobile-touch §12, board 04): weapon and bag | the chosen card and the worn weapon |
  // «Если надеть» and the buttons. Without a chosen item the buttons hide.
  touchGear(v, left, summary, card) {
    const chosen = v.chosen, slot = this.controller.focus.gear;
    const actions = chosen.worn ? [h('button', { type: 'button', class: 'mp-action', 'data-unequip': true, text: 'Снять' })]
      : chosen.card ? [h('button', { type: 'button', class: 'mp-action equip', 'data-equip': slot, text: 'Надеть' }),
        h('button', { type: 'button', class: 'mp-action drop', 'data-drop': slot, text: 'Держи — выбросить' })] : [];
    const note = v.message ? h('p', { class: 'mp-note t-coral', text: v.message })
      : v.firstChoice ? h('p', { class: 'mp-note t-amber', text: 'Выбери оружие и нажми «Надеть»' }) : null;
    return [h('div', { class: 'mp-gear-touch' },
      h('div', { class: 'mp-gear-col' }, ...left),
      h('div', { class: 'mp-gear-col' },
        h('div', { class: 'mp-line mp-head' }, h('span', { class: 't-muted', text: chosen.label }),
          chosen.isNew ? h('span', { class: 't-amber mp-fresh', text: 'новое' }) : null,
          h('span', { class: 'mp-spacer' }), h('span', { class: 't-dim', text: chosen.cell })),
        card,
        h('div', { class: 'mp-line mp-worn' }, h('span', { class: 'mp-shrink t-muted', text: `Надето: ${v.equippedCard.name}` }),
          h('span', { class: 't-ivory', text: `${v.equippedCard.dps}/с` }))),
      h('div', { class: 'mp-gear-col' }, summary, note, h('div', { class: 'mp-actions' }, ...actions)))];
  }

  skills() {
    const v = this.controller.skillsView(), d = v.detail, k = this.controller.keys;
    // The keyboard slots a technique by key over its row; a pad picks it with ✕ (A), then a slot with ✕ (A).
    const touch = !!k.touch, pad = !touch && k !== KEYBOARD_KEYS, techniqueKeys = SLOTS.filter(slot => slot.accepts === 'technique').map(slot => slotKey(k, slot.id));
    const slotKeys = `${techniqueKeys.slice(0, -1).join(', ')} или ${techniqueKeys.at(-1)}`;
    const slotRow = h('div', { class: 'mp-slot-row' },
      h('div', { class: 'mp-slots' }, ...v.slots.map(slot => h('button', { type: 'button',
        class: `skill mp-slot${slot.locked ? ' locked' : ''}${!slot.locked && !slot.skill ? ' empty' : ''}${slot.selected ? ' selected' : ''}${slot.target ? ' target' : ''}${slot.isNew ? ' new' : ''}`,
        'data-slot': slot.id, vars: slot.id === 'lmb' ? { 'skill-accent': 'var(--coral)' } : null,
        'aria-label': `${slot.label}: ${slot.locked ? `откроется на ур. ${slot.unlockLevel}` : slot.skill ? SKILLS[slot.skill].name : 'пусто'}` },
      h('span', { class: 'keycap', text: slot.label }),
      h('span', { class: 'skill-well' }, slot.skill ? use('', '0 0 24 24', `icon-${slot.skill}`) : null),
      use('skill-lock', '0 0 12 12', 'icon-lock'),
      h('span', { class: 'skill-unlock', text: slot.locked ? `ур. ${slot.unlockLevel}` : '' }),
      h('span', { class: 'skill-blank', 'aria-hidden': 'true', text: k.skills }),
      h('i', { class: 'skill-new', 'aria-hidden': 'true' }),
      slot.cost && !slot.locked ? h('span', { class: 'skill-cost', text: slot.cost }) : null,
      slot.fixed ? h('span', { class: 'mp-fixed' }, use('', '0 0 5 6', 'lock-badge')) : null,
      slot.strikes ? h('span', { class: 'combo-pips' }, ...Array.from({ length: slot.strikes }, () => h('i'))) : null))),
      v.message ? h('div', { class: 'mp-slot-hint' }, h('span', { class: 't-coral', text: v.message }))
        : v.picked ? h('div', { class: 'mp-slot-hint' }, h('span', { class: 't-amber', text: `«${v.picked}»:` }),
          h('span', { class: 't-ivory', text: touch ? `коснись кнопки ${slotKeys}.` : `${k['nav:ok']} на слот ${slotKeys}.` }),
          h('span', { class: 't-dim', text: touch ? 'Ещё раз — отмена.' : `${k['nav:back']} — отмена.` }))
          : h('div', { class: 'mp-slot-hint' },
            h('span', { class: 't-ivory', text: touch ? 'Коснись техники в списке,' : pad ? `${k['nav:ok']} на технике,` : 'Наведи на технику и нажми' }),
            h('span', { class: 't-ivory', text: touch ? `затем кнопки ${slotKeys}.` : pad ? `затем ${k['nav:ok']} на слоте.` : `${slotKeys}.` }),
            h('span', { class: 't-dim', text: 'Смена — полная перезарядка.' })));
    const list = h('div', { class: 'mp-skill-list', role: 'list' }, ...v.rows.map(row => h('button', { type: 'button',
      class: `mp-skill ${row.status}${row.selected ? ' selected' : ''}${row.picked ? ' picked' : ''}`, 'data-skill': row.id,
      'aria-label': `${row.name}: ${row.status === 'locked' ? `откроется на ур. ${row.unlockLevel}` : row.key ?? 'без слота'}` },
    h('span', { class: 'mp-skill-icon' }, this.icon(row.icon), row.isNew ? h('i', { class: 'mp-skill-new' }) : null),
    h('span', { class: 'mp-skill-name', text: row.name }),
    row.status === 'locked' ? h('span', { class: 'mp-skill-locked' }, use('', '0 0 5 6', 'lock-small'), h('span', { text: `ур. ${row.unlockLevel}` }))
      : row.status === 'unslotted' ? h('span', { class: 'mp-unslotted mp-dashed', text: 'без слота' })
        : [h('span', { class: 'mp-skill-key' }, kbd(row.key, row.id === 'combo' ? 'combo' : row.id === 'dash' ? 'dash' : '')),
          row.id === 'dash' ? null : h('span', { class: `mp-skill-cost t-${row.costTone === 'gain' ? 'spirit-light' : 'spirit'}`, text: row.cost })])));
    const numbers = h('div', { class: 'mp-numbers' }, ...d.numbers.map(cell => h('div', {},
      h('span', { class: 't-dim', text: cell.label }), h('span', { class: `t-${cell.tone ?? 'ivory'}`, text: cell.value }))));
    const modifiers = d.modifiers.length ? d.modifiers.map(modifier => h('button', { type: 'button',
      class: `mp-mod${modifier.selected ? ' selected' : ''}${modifier.locked ? ' locked' : ''}`, 'data-modifier': modifier.id, 'data-owner': d.id,
      disabled: modifier.locked || d.locked },
    h('span', { class: 'mp-line' }, h('span', { class: modifier.locked ? 't-dim' : 't-ivory', text: modifier.name }),
      modifier.selected ? h('span', { class: 't-amber', text: 'выбран' }) : modifier.locked ? h('span', { class: 't-dim', text: `ур. ${d.modifierLevel}` }) : null),
    h('span', { class: modifier.locked ? 't-dim' : 't-muted', text: modifier.text })))
      : [h('div', { class: 'mp-mod-none' }, h('span', { class: 't-muted', text: 'Серию меняет оружие.' }), h('span', { class: 't-dim', text: `${k.gearTab} — снаряжение: кастеты или посох.` }))];
    const detail = h('div', { class: 'mp-detail' },
      h('div', { class: 'mp-detail-head' }, h('strong', { text: d.name, class: d.name.length > 14 ? 'longer' : d.name.length > 12 ? 'long' : null }),
        h('span', { class: d.unslotted || d.locked ? 't-dim' : d.id === 'combo' ? 't-coral' : 't-spirit', text: d.kind })),
      h('p', { class: `mp-detail-text${d.unslotted ? ' unslotted' : ''}` },
        d.unslotted ? h('span', { class: 't-ivory', text: touch ? `Без слота: коснись кнопки ${slotKeys}, чтобы поставить. `
          : pad ? `Без слота: ${k['nav:ok']} здесь, затем ${k['nav:ok']} на слоте. ` : `Без слота: нажми ${slotKeys}, чтобы поставить. ` }) : null,
        h('span', { class: 't-muted', text: d.text })),
      numbers,
      h('div', { class: 'mp-shell' }, h('span', { class: 't-muted', text: 'Панцирник:' }), h('b', { text: d.shell }), h('span', { class: 't-dim', text: d.shellNote })),
      h('div', { class: 'mp-line mp-mod-head' }, h('span', { class: 't-ivory', text: 'Модификатор' }),
        h('span', { class: 't-dim', text: d.modifiers.length ? 'один на умение · бесплатно' : '' })),
      h('div', { class: 'mp-mods' }, ...modifiers));
    return [slotRow, h('div', { class: 'mp-skill-body' }, list, detail)];
  }
}

// A stable selector for a control, so a redraw can give the focus back to its new copy.
function selectorOf(element) {
  for (const name of ['node', 'bag', 'skill', 'slot', 'modifier']) {
    const value = element.getAttribute?.(`data-${name}`);
    if (value !== null && value !== undefined) return `[data-${name}="${value}"]`;
  }
  for (const name of ['weapon', 'respec']) if (element.hasAttribute?.(`data-${name}`)) return `[data-${name}]`;
  return null;
}
