// Skill, slot and modifier rules from docs/design/skills-gear-progression.md §2.
// Pure data and functions: game.js casts skills, the HUD and the monk panel only read them.
import { MONK_RULES } from './monk-combat.js';
import { BEETLE_STATS } from './campaign.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// HUD order. LMB always holds the weapon combo and Space the dash; the rest take any technique.
export const SLOTS = freeze([
  { id: 'lmb', label: 'ЛКМ', button: 0, accepts: 'combo', unlockLevel: 1 },
  { id: 'space', label: 'Пробел', code: 'Space', accepts: 'dash', unlockLevel: 1 },
  { id: 'rmb', label: 'ПКМ', button: 2, accepts: 'technique', unlockLevel: 1 },
  { id: 'q', label: 'Q', code: 'KeyQ', accepts: 'technique', unlockLevel: 2 },
  { id: 'f', label: 'F', code: 'KeyF', accepts: 'technique', unlockLevel: 4 },
]);
const SLOT = Object.fromEntries(SLOTS.map(slot => [slot.id, slot]));
export const TECHNIQUE_SLOTS = freeze(SLOTS.filter(slot => slot.accepts === 'technique').map(slot => slot.id));

// Shell rules (§2.4). shell says how a hit that does not break the shell is judged:
//   'block'  a hit from the front sector, seen from the monk, deals BEETLE_STATS.blockDamage;
//   'origin' the same, seen from the landing or bell point;
//   'full'   never blocked: the hit comes from behind or answers the beetle's own strike.
// shellBreak: true, false, 'deflectedSlam' (only a deflected slam) or 'finalStrike' (only the last hit).
const DEFAULTS = { cost: 0, cooldown: 0, charges: 1, shell: 'block', shellBreak: false, castDuringDash: false };
// A modifier replaces base values; every key it changes exists in base, so params keep one shape.
const skill = (id, name, kind, unlockLevel, modifierLevel, base, modifiers = []) => ({
  id, name, kind, unlockLevel, modifierLevel, base: { ...DEFAULTS, ...base },
  modifiers: modifiers.map(([id, name, changes]) => ({ id, name, changes })),
});
// A mantra modifier changes the mantra type: «Стойкость» damage reduction goes away.
const NO_FORTITUDE = { auraDamageReduction: 0, burstDamageReduction: 0 };

// Numbers are level 1, before multipliers. Techniques are listed in unlock order.
export const SKILLS = freeze(Object.fromEntries([
  skill('combo', 'Серия ударов', 'combo', 1, null, { ...MONK_RULES.combo,
    spiritPerStrike: MONK_RULES.spirit.perStrike, spiritPerBlockedStrike: MONK_RULES.spirit.perBlockedStrike }),
  skill('dash', 'Пробивающий шаг', 'dash', 1, 3, { ...MONK_RULES.dash, invulnerable: true,
    spiritPerHit: 0, spiritCap: 0, shellBreak: true }, [
    ['doubleStep', 'Двойной шаг', { charges: 2, cooldown: 1.6, damage: 24 }],
    ['crushingStep', 'Сокрушающий шаг', { damage: 60, knockback: .6, cooldown: 2.2 }],
    ['spiritStep', 'Шаг духа', { spiritPerHit: 6, spiritCap: 18 }],
  ]),
  skill('wave', 'Волна духа', 'technique', 1, 3, { ...MONK_RULES.wave,
    pullRadius: 0, pullTo: 0, healPerHit: 0, healCap: 0, shellBreak: true }, [
    ['heavyWave', 'Тяжёлая волна', { radius: 2.6, damage: 110, knockback: 1.4 }],
    ['vortexWave', 'Вихревая волна', { pullRadius: 4.4, pullTo: .9, damage: 48 }],
    ['calmWave', 'Волна покоя', { healPerHit: 4, healCap: 20, damage: 60 }],
  ]),
  // A shell's front stops every palm, a piercing one too.
  skill('palm', 'Ладонь духа', 'technique', 2, 4, { cost: 20, cooldown: .5, damage: 40, knockback: .3,
    speed: 12, range: 7, projectiles: 1, spreadDegrees: 0, pierce: false,
    markDuration: 0, explosionRadius: 0, explosionDamage: 0 }, [
    ['piercingPalm', 'Пронзающая ладонь', { pierce: true, damage: 32 }],
    ['explodingPalm', 'Взрывная ладонь', { markDuration: 3, explosionRadius: 2, explosionDamage: 40 }],
    ['palmFan', 'Веер ладоней', { projectiles: 3, spreadDegrees: 14, damage: 24, cost: 26 }],
  ]),
  skill('crane', 'Прыжок журавля', 'technique', 4, 6, { cost: 30, cooldown: 4, damage: 56, knockback: .5,
    minRange: 1.5, range: 5, flightTime: .4, radius: 1.6, invulnerable: true, shell: 'origin' }, [
    ['mountainFall', 'Падение горы', { radius: 2.4, damage: 80, cooldown: 6 }],
    ['lightCrane', 'Лёгкий журавль', { cost: 12, range: 6.5, damage: 30 }],
    ['shatteringLanding', 'Раскалывающее приземление', { shellBreak: true, damage: 44 }],
  ]),
  // riposteRadius 0: the riposte answers only the attacker. The cooldown starts after the window.
  skill('deflect', 'Отражение', 'technique', 5, 6, { cooldown: 3, damage: 60, window: .4, stun: .6,
    spiritOnSuccess: 20, reflectDamage: 40, whiffLockout: .35, riposteRadius: 0, resetsDash: false,
    shellBreak: 'deflectedSlam', castDuringDash: true }, [
    ['spiritRiposte', 'Ответный дух', { spiritOnSuccess: 35, resetsDash: true }],
    ['wideStance', 'Широкая стойка', { window: .65, damage: 36 }],
    ['circularRiposte', 'Круговой ответ', { riposteRadius: 1.8, damage: 45 }],
  ]),
  skill('bell', 'Колокол тишины', 'technique', 6, 7, { cost: 35, cooldown: 6, damage: 44, chimes: [.5, 1.5],
    radius: 2.4, castRange: 6, maxActive: 1, stun: .6, stunKinds: ['hound', 'wraith'],
    lureDuration: 0, lureRadius: 0, lureKinds: [], healPerChime: 0, shell: 'origin' }, [
    ['beaconBell', 'Колокол-маяк', { lureDuration: 2, lureRadius: 4.5, lureKinds: ['hound', 'beetle'], damage: 30 }],
    ['tripleChime', 'Тройной звон', { chimes: [.5, 1.3, 2.1], damage: 36, cost: 40 }],
    ['calmBell', 'Колокол покоя', { healPerChime: 8, damage: 36 }],
  ]),
  // The aura works only while the mantra sits in a slot; the cost is paid by the burst.
  skill('mantra', 'Мантра стойкости', 'technique', 7, 8, { cost: 25, cooldown: 12, burstDuration: 4,
    auraDamageReduction: .08, burstDamageReduction: .32, retaliationDamage: 0, burstDamage: 0, burstStun: 0,
    auraHealPerSecond: 0, burstHealPerSecond: 0, auraSpiritPerStrike: 0, burstSpiritPerSecond: 0, shell: 'full' }, [
    ['retribution', 'Воздаяние', { ...NO_FORTITUDE, retaliationDamage: 15, burstDamage: 45, burstStun: .4 }],
    ['healing', 'Исцеление', { ...NO_FORTITUDE, auraHealPerSecond: 1, burstHealPerSecond: 6 }],
    ['clarity', 'Ясность', { ...NO_FORTITUDE, auraSpiritPerStrike: 2, burstSpiritPerSecond: 6 }],
  ]),
  // Every strike lands in the target's back.
  skill('sevenStrikes', 'Семь ударов', 'technique', 9, 10, { cost: 60, cooldown: 14, hits: 7, damage: 30,
    interval: .1, radius: 4.5, invulnerableTime: .7, finalHitMultiplier: 1, stun: 0, stunKinds: [], shell: 'full' }, [
    ['nineStrikes', 'Девять ударов', { hits: 9, damage: 26 }],
    ['finalStrike', 'Последний удар', { finalHitMultiplier: 3, shellBreak: 'finalStrike' }],
    ['stunningStrikes', 'Оглушающие удары', { stun: 1, stunKinds: ['hound', 'wraith'], damage: 24 }],
  ]),
].map(entry => [entry.id, entry])));
export const TECHNIQUES = freeze(Object.values(SKILLS).filter(entry => entry.kind === 'technique').map(entry => entry.id));

const modifierChanges = (skillId, modifierId) => SKILLS[skillId].modifiers.find(m => m.id === modifierId).changes;
// Skill-side spirit flow (§2.5). Weapon strike gains belong to the weapon tables.
export const SPIRIT_ECONOMY = freeze({
  initial: MONK_RULES.spirit.initial,
  gain: {
    strike: MONK_RULES.spirit.perStrike, blockedStrike: MONK_RULES.spirit.perBlockedStrike,
    deflect: SKILLS.deflect.base.spiritOnSuccess,
    spiritStepPerHit: modifierChanges('dash', 'spiritStep').spiritPerHit,
    spiritStepCap: modifierChanges('dash', 'spiritStep').spiritCap,
  },
  cost: Object.fromEntries(TECHNIQUES.map(id => [id, SKILLS[id].base.cost])),
});

export const SHELL_LABELS = freeze({ block: 'Блок спереди', break: 'Раскалывает', full: 'Полный урон', origin: 'От точки удара' });
export const shellLabel = params => params.shellBreak === false ? params.shell : 'break';

export const unlockedTechniques = level => TECHNIQUES.filter(id => SKILLS[id].unlockLevel <= level);
export const unlockedSlots = level => SLOTS.filter(slot => slot.unlockLevel <= level).map(slot => slot.id);
export function unlocksAtLevel(level) {
  return {
    techniques: TECHNIQUES.filter(id => SKILLS[id].unlockLevel === level),
    slots: SLOTS.filter(slot => slot.unlockLevel === level).map(slot => slot.id),
    modifiers: Object.values(SKILLS).filter(entry => entry.modifierLevel === level).map(entry => entry.id),
  };
}

const DAMAGE_FIELDS = ['damage', 'explosionDamage', 'reflectDamage', 'retaliationDamage', 'burstDamage'];
const scaleDamage = (value, factor) => Array.isArray(value)
  ? value.map(item => Math.round(item * factor)) : Math.round(value * factor);
// Resolved numbers of any skill with its modifier (null for none). scale holds the caller's
// multipliers: damage (level × weapon power × affixes × path), cooldown and cost. Damage and
// cost round to whole points.
export function techniqueParams(skillId, modifierId = null, { damage = 1, cooldown = 1, cost = 1 } = {}) {
  const entry = SKILLS[skillId];
  if (!entry) throw new Error(`Unknown skill: ${skillId}`);
  const modifier = modifierId == null ? null : entry.modifiers.find(m => m.id === modifierId);
  if (modifier === undefined) throw new Error(`Skill ${skillId} has no modifier ${modifierId}`);
  const params = { ...entry.base, ...modifier?.changes };
  for (const field of DAMAGE_FIELDS) if (field in params) params[field] = scaleDamage(params[field], damage);
  params.cooldown *= cooldown;
  params.cost = Math.round(params.cost * cost);
  return freeze(params);
}

// One hit on a beetle (§2.4). front: the hit origin is inside the beetle's front sector.
// damage defaults to params.damage; pass the strike's value for the combo or a final hit.
export function beetleHit(params, { front = false, exposed = false, breakImmune = false,
  deflectedSlam = false, finalStrike = false, damage = params.damage } = {}) {
  const breaks = !exposed && !breakImmune && (params.shellBreak === true
    || (params.shellBreak === 'deflectedSlam' && deflectedSlam) || (params.shellBreak === 'finalStrike' && finalStrike));
  const blocked = !exposed && !breaks && front && params.shell !== 'full';
  return { damage: blocked ? Math.round(damage * BEETLE_STATS.blockDamage) : damage, blocked, breaks };
}

// A loadout maps slots to skill ids and skills to their chosen modifier (absent or null: none).
// Functions return new loadouts and never change the one they get.
export function createLoadout() {
  return { slots: { lmb: 'combo', space: 'dash', rmb: 'wave', q: null, f: null }, modifiers: {} };
}
const copy = loadout => ({ slots: { ...loadout.slots }, modifiers: { ...loadout.modifiers } });
export const slotOf = (loadout, skillId) => skillId == null ? null
  : Object.keys(loadout.slots).find(slot => loadout.slots[slot] === skillId) ?? null;
export function techniqueStatus(loadout, skillId, level) {
  if (SKILLS[skillId].unlockLevel > level) return 'locked';
  return slotOf(loadout, skillId) ? 'slotted' : 'unslotted';
}

// Techniques unlocked after previousLevel up to level take the first empty open technique slot,
// otherwise they stay unslotted (§2.1, §2.9.3). They start ready: rule 2.9.8 covers player swaps.
export function learnTechniques(loadout, previousLevel, level) {
  const next = copy(loadout), learned = [];
  for (const id of TECHNIQUES) {
    const { unlockLevel } = SKILLS[id];
    if (unlockLevel <= previousLevel || unlockLevel > level) continue;
    const slot = slotOf(next, id)
      ?? TECHNIQUE_SLOTS.find(s => SLOT[s].unlockLevel <= level && next.slots[s] === null) ?? null;
    if (slot) next.slots[slot] = id;
    learned.push({ technique: id, slot });
  }
  return { loadout: next, learned };
}

// Player slotting (§2.8, §2.9), free and allowed in combat too. The previous technique of the
// slot becomes unslotted, or takes the vacated slot when the new one was slotted elsewhere.
// restarted lists the skills that go on full cooldown (see fullCooldown).
export function assignToSlot(loadout, slot, technique, { level }) {
  if (!TECHNIQUE_SLOTS.includes(slot)) return { ok: false, reason: 'not-technique-slot' };
  if (SLOT[slot].unlockLevel > level) return { ok: false, reason: 'slot-locked' };
  if (SKILLS[technique]?.kind !== 'technique') return { ok: false, reason: 'not-technique' };
  if (SKILLS[technique].unlockLevel > level) return { ok: false, reason: 'technique-locked' };
  const next = copy(loadout), previous = next.slots[slot], from = slotOf(next, technique);
  if (previous === technique) return { ok: true, loadout: next, restarted: [] };
  next.slots[slot] = technique;
  if (from) next.slots[from] = previous;
  return { ok: true, loadout: next, restarted: from && previous ? [technique, previous] : [technique] };
}

// One modifier per skill, or null for none (§2.6, §2.8). An unslotted technique keeps it.
export function chooseModifier(loadout, skillId, modifierId, { level }) {
  const entry = SKILLS[skillId];
  if (!entry?.modifiers.length) return { ok: false, reason: 'no-modifiers' };
  if (modifierId !== null && !entry.modifiers.some(m => m.id === modifierId)) return { ok: false, reason: 'unknown-modifier' };
  if (modifierId !== null && entry.modifierLevel > level) return { ok: false, reason: 'modifier-locked' };
  const next = copy(loadout);
  if ((next.modifiers[skillId] ?? null) === modifierId) return { ok: true, loadout: next, restarted: [] };
  next.modifiers[skillId] = modifierId;
  return { ok: true, loadout: next, restarted: [skillId] };
}

// cooldowns maps skill ids to seconds left. A cast adds params.cooldown to that value; with
// charges it is recharge debt, so the skill stays ready while one charge remains.
export const fullCooldown = params => params.charges * params.cooldown;
export function canCast(loadout, slot, { spirit, cooldowns = {}, dashing = false, scale } = {}) {
  const skillId = loadout.slots[slot];
  if (!skillId) return false;
  const params = techniqueParams(skillId, loadout.modifiers[skillId], scale);
  if (dashing && !params.castDuringDash) return false;
  return spirit >= params.cost && (cooldowns[skillId] ?? 0) <= (params.charges - 1) * params.cooldown + 1e-9;
}
