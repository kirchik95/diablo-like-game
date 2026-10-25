// Run progression in game state: experience, level-ups, monk stats, cooldowns and the loadout.
// game.js calls the hooks; the HUD and the monk panel call the actions and read game state.
import { emit } from './game-events.js';
import {
  createProgression, damageMultiplier, grantXp, progressionStats, respec, spendPoint, xpReward,
} from './progression.js';
import { applyItemStats } from './items.js';
import {
  SLOTS, assignToSlot, canCast, chooseModifier, fullCooldown, learnTechniques, techniqueParams, unlocksAtLevel,
} from './skills.js';

const LEVEL_ONE = progressionStats(createProgression());

// Level, path and equipped item stats in one record; applyItemStats names the item fields.
export function monkStats(game) {
  return applyItemStats(game.progression ? progressionStats(game.progression) : LEVEL_ONE, game.inventory?.equipped);
}

// Monk damage of one hit (§6.1): base × level and path × weapon power × (1 + matching affix).
// kind is 'combo', 'dash' or 'technique'; the target decides the path conditions. gear replaces the
// equipped items' weaponPower and affixes, e.g. with the values a swing recorded when it started.
export function monkDamage(game, base, kind, target = null, { finisher = false, gear = null } = {}) {
  const items = gear ?? monkStats(game);
  const path = game.progression ? damageMultiplier(game.progression, { source: kind, finisher,
    windup: target?.state === 'windup', targetHpFraction: target ? target.hp / target.maxHp : 1 }) : 1;
  return Math.round(base * path * items.weaponPower * (1 + (kind === 'combo' ? items.comboDamage : items.skillDamage)));
}

// techniqueParams scale for the HUD: damage before per-target path conditions, then cooldown
// and cost multipliers. Casts use the same cooldown and cost and scale damage per hit.
export function skillScale(game) {
  const stats = monkStats(game);
  const path = game.progression ? damageMultiplier(game.progression, { source: 'technique' }) : 1;
  return { damage: path * stats.weaponPower * (1 + stats.skillDamage), cooldown: 1 - stats.cooldownReduction,
    cost: stats.techniqueCost };
}

// Cast numbers of a skill with its chosen modifier; damage stays the level 1 base.
export function skillParams(game, skillId) {
  return techniqueParams(skillId, game.loadout?.modifiers[skillId] ?? null, { ...skillScale(game), damage: 1 });
}

// Seconds left. The dash and the wave keep their HUD fields; other techniques use player.cooldowns.
export function skillCooldown(game, skillId) {
  const p = game.player;
  return skillId === 'dash' ? p.dashCooldown : skillId === 'wave' ? p.waveCooldown : p.cooldowns?.[skillId] ?? 0;
}

export function setSkillCooldown(game, skillId, seconds) {
  const p = game.player;
  if (skillId === 'dash') p.dashCooldown = seconds;
  else if (skillId === 'wave') p.waveCooldown = seconds;
  else (p.cooldowns ??= {})[skillId] = seconds;
}

// Recomputes the maxima after a level, path or equipment change. Health and spirit stay within them.
export function refreshStats(game) {
  const p = game.player, stats = monkStats(game);
  p.maxHp = stats.maxHp; p.maxSpirit = stats.maxSpirit;
  p.hp = Math.min(p.hp, p.maxHp); p.spirit = Math.min(p.spirit, p.maxSpirit);
  return stats;
}

// Grants the experience of one source (§4.1) at a world point.
export function awardXp(game, source, at, monsterLevel = 1) {
  return game.progression ? gainXp(game, xpReward(source, monsterLevel), source, at) : 0;
}

// Adds experience and applies every level gained. Returns the experience actually granted:
// at the level cap that is less than asked, and nothing granted sends no 'xp' event.
export function gainXp(game, amount, source = 'debug', at = game.player) {
  if (!game.progression || !amount) return 0;
  const before = game.progression.level, xpBefore = game.progression.xp, levels = grantXp(game.progression, amount);
  const gained = game.progression.xp - xpBefore;
  if (!gained) return 0;
  emit(game, 'xp', at.x, at.y, { amount: gained, source, xp: game.progression.xp, level: game.progression.level });
  if (levels.length) levelUp(game, before, levels);
  return gained;
}

// §4.4: each level raises maximum and current health and the spirit maximum. Learned techniques
// take the first empty open slot or stay unslotted, and start ready. An unslotted one is listed in
// game.newTechniques until the player slots it for the first time (see assignSkill).
function levelUp(game, before, levels) {
  const p = game.player;
  for (const { level, hp, spirit, points, pathRow } of levels) {
    p.hp += hp;
    emit(game, 'level-up', p.x, p.y, { level, hp, spirit, points, pathRow, unlocks: unlocksAtLevel(level) });
  }
  refreshStats(game);
  if (!game.loadout) return;
  const { loadout, learned } = learnTechniques(game.loadout, before, game.progression.level);
  game.loadout = loadout;
  for (const { technique, slot } of learned) {
    if (!slot) game.newTechniques = [...new Set([...game.newTechniques ?? [], technique])];
    emit(game, 'technique-learned', p.x, p.y, { technique, slot });
  }
}

// The slot states the HUD draws, in SLOTS order. maxCooldown is the full recharge.
export function slotStates(game) {
  const p = game.player, level = game.progression?.level ?? 1;
  return SLOTS.map(slot => {
    const skill = game.loadout?.slots[slot.id] ?? null, locked = slot.unlockLevel > level;
    if (!skill || slot.id === 'lmb') return { slot: slot.id, skill, locked, ready: !locked && !!skill };
    const params = skillParams(game, skill), cooldown = skillCooldown(game, skill);
    // The crane flight, the deflect stance and a whiffed stance's lockout make useSlot answer 'busy'.
    return { slot: slot.id, skill, locked, cost: params.cost, cooldown, maxCooldown: fullCooldown(params),
      ready: !locked && !p.technique && !(p.lockout > 1e-9) && canCast(game.loadout, slot.id, { spirit: p.spirit,
        cooldowns: { [skill]: cooldown }, dashing: p.dashTime > 0, scale: { ...skillScale(game), damage: 1 } }) };
  });
}

const applyLoadout = (game, result) => {
  if (!result.ok) return result;
  game.loadout = result.loadout;
  for (const id of result.restarted) setSkillCooldown(game, id, fullCooldown(skillParams(game, id)));
  emit(game, 'loadout', game.player.x, game.player.y, { slots: { ...result.loadout.slots }, restarted: result.restarted });
  return result;
};

// Player slotting (§2.8, §2.9): free, allowed in combat; changed skills restart their cooldown.
// Exception (§2.9, rule 8): a technique learned without a free slot enters its first slot ready,
// even after a modifier change; every later slotting restarts it as usual.
export function assignSkill(game, slot, technique) {
  const result = assignToSlot(game.loadout, slot, technique, { level: game.progression.level });
  if (!result.ok || !game.newTechniques?.includes(technique)) return applyLoadout(game, result);
  game.newTechniques = game.newTechniques.filter(id => id !== technique);
  setSkillCooldown(game, technique, 0);
  return applyLoadout(game, { ...result, restarted: result.restarted.filter(id => id !== technique) });
}

export function chooseSkillModifier(game, skillId, modifierId) {
  return applyLoadout(game, chooseModifier(game.loadout, skillId, modifierId, { level: game.progression.level }));
}

// A pack pursuing the monk means combat for the respec rule (§4.6).
export const inCombat = game => game.enemies.some(e => e.active && !e.returning && e.hp > 0);

// A node that raises maximum health («Закалка») raises current health by the same amount, like a
// level (§4.4). A respec takes that health back (never below 1), so respec and spend never heal.
function changeMaxHp(game, change) {
  const p = game.player, before = p.maxHp, hpBefore = p.hp;
  change();
  refreshStats(game);
  // Apply the delta to the original health, before refreshStats clamps it to the new maximum.
  p.hp = Math.max(Math.min(hpBefore, 1), Math.min(p.maxHp, hpBefore + p.maxHp - before));
}

export function spendPathPoint(game, nodeId) {
  let result;
  changeMaxHp(game, () => { result = spendPoint(game.progression, nodeId); });
  if (result.ok) emit(game, 'path', game.player.x, game.player.y, { node: nodeId });
  return result;
}

export function respecPath(game) {
  let result;
  changeMaxHp(game, () => { result = respec(game.progression, { inCombat: inCombat(game) }); });
  if (result.ok) emit(game, 'path', game.player.x, game.player.y, { refunded: result.refunded });
  return result;
}
