// Run progression: experience, levels, the «Путь монаха» tree and monster level scaling.
// Engine-free. Functions mutate the plain state from createProgression() and return results.
import { MONK_RULES } from './monk-combat.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const PROGRESSION_RULES = freeze({
  maxLevel: 10,
  // Total experience at which each level starts; index 0 is level 1.
  levelXp: [0, 80, 220, 450, 840, 1510, 2650, 4580, 7860, 13440],
  base: { maxHp: 100, maxSpirit: MONK_RULES.spirit.max },
  // Every level past the first adds these. Health raises both maximum and current health.
  perLevel: { maxHp: 8, maxSpirit: 5, damage: .04, points: 1 },
  xp: {
    // Kills scale with monster level; the other sources are flat. `secret` is the side-path cache.
    monster: { hound: 10, wraith: 14, beetle: 30 },
    flat: { pack: 15, secret: 60, ritual: 60, shrine: 0 },
  },
  // Increase per monster level above 1, multiplying the base value.
  monsterLevel: { hp: .18, damage: .08, xp: .25 },
  zoneMonsterLevel: { camp: 1, road: 1, courtyard: 2, cemetery: 2, orchard: 3 },
});

// Branch nodes are taken in row order. A row opens at its level in rowLevels.
// Damage effects multiply when the hit matches their sources and condition (see damageMultiplier).
export const MONK_PATH = freeze({
  branches: ['body', 'spirit', 'strike'],
  rowLevels: [2, 4, 6, 8],
  nodes: [
    { id: 'tempering', branch: 'body', row: 1, title: 'Закалка', text: '+15 к здоровью',
      effect: { maxHp: 15 } },
    { id: 'second-wind', branch: 'body', row: 2, title: 'Второе дыхание', text: 'Подбор здоровья лечит 26 вместо 18',
      effect: { pickupHeal: 26 } },
    { id: 'stone-skin', branch: 'body', row: 3, title: 'Каменная кожа', text: '−10% получаемого урона',
      effect: { damageTaken: .9 } },
    { id: 'last-breath', branch: 'body', row: 4, title: 'Последний вздох',
      text: 'При здоровье ниже 25% — 1,5 с неуязвимости, раз в 60 с',
      effect: { lastBreath: { hpBelow: .25, invulnerable: 1.5, cooldown: 60 } } },
    { id: 'deep-breath', branch: 'spirit', row: 1, title: 'Глубокий вдох', text: '+20 к максимуму духа',
      effect: { maxSpirit: 20 } },
    { id: 'resonance', branch: 'spirit', row: 2, title: 'Отклик',
      text: 'Удар только в закрытый панцирь даёт 8 духа вместо 4', effect: { blockedStrikeSpirit: 8 } },
    { id: 'calm-mind', branch: 'spirit', row: 3, title: 'Спокойный ум', text: 'Техники стоят на 15% меньше духа',
      effect: { techniqueCost: .85 } },
    { id: 'flow', branch: 'spirit', row: 4, title: 'Поток', text: 'Победа над монстром даёт 5 духа',
      effect: { killSpirit: 5 } },
    { id: 'steady-hand', branch: 'strike', row: 1, title: 'Твёрдая рука', text: '+8% урона серии',
      effect: { damage: { multiplier: 1.08, sources: ['combo'] } } },
    { id: 'intercept', branch: 'strike', row: 2, title: 'Перехват', text: 'Удар по монстру в замахе +25% урона',
      effect: { damage: { multiplier: 1.25, condition: 'windup' } } },
    { id: 'combo-finale', branch: 'strike', row: 3, title: 'Финал серии', text: 'Последний удар серии +25% урона',
      effect: { damage: { multiplier: 1.25, sources: ['combo'], condition: 'finisher' } } },
    { id: 'execution', branch: 'strike', row: 4, title: 'Добивание',
      text: 'Удар серии по монстру ниже 20% здоровья наносит двойной урон',
      effect: { damage: { multiplier: 2, sources: ['combo'], condition: 'lowHp', hpBelow: .2 } } },
  ],
});

const nodeById = id => MONK_PATH.nodes.find(node => node.id === id);
const takenNodes = state => state.path.map(nodeById);

export function createProgression() {
  return { xp: 0, level: 1, path: [] };
}

// «Начать заново» starts a new run at level 1 with an empty path.
export function resetProgression(state) {
  return Object.assign(state, createProgression());
}

export function levelForXp(xp) {
  const { levelXp } = PROGRESSION_RULES;
  let level = 1;
  while (level < levelXp.length && xp >= levelXp[level]) level++;
  return level;
}

// Experience stops at the level cap. Returns one level-up event per level gained.
export function grantXp(state, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Invalid experience amount: ${amount}`);
  const { levelXp, maxLevel, perLevel } = PROGRESSION_RULES;
  state.xp = Math.min(state.xp + amount, levelXp[maxLevel - 1]);
  const events = [];
  for (const target = levelForXp(state.xp); state.level < target;) {
    state.level++;
    const pathRow = MONK_PATH.rowLevels.indexOf(state.level) + 1 || null;
    events.push({ type: 'level-up', level: state.level, hp: perLevel.maxHp, spirit: perLevel.maxSpirit,
      points: perLevel.points, pathRow });
  }
  return events;
}

// Bar data: total experience, where the current level starts and the next one begins (null at the cap).
export function xpProgress(state) {
  const { levelXp, maxLevel } = PROGRESSION_RULES;
  const start = levelXp[state.level - 1], next = state.level < maxLevel ? levelXp[state.level] : null;
  return { xp: state.xp, start, next, fraction: next === null ? 1 : (state.xp - start) / (next - start) };
}

export function xpReward(source, monsterLevel = 1) {
  const { monster, flat } = PROGRESSION_RULES.xp;
  if (Object.hasOwn(monster, source)) return Math.round(monster[source] * monsterLevelMultipliers(monsterLevel).xp);
  if (Object.hasOwn(flat, source)) return flat[source];
  throw new RangeError(`Unknown experience source: ${source}`);
}

export function pointsEarned(level) {
  return (level - 1) * PROGRESSION_RULES.perLevel.points;
}

export function unspentPoints(state) {
  return pointsEarned(state.level) - state.path.length;
}

// 'taken', 'level' (row not open yet), 'order' (previous node of the branch missing) or 'available'.
export function pathNodeStatus(state, nodeId) {
  const node = nodeById(nodeId);
  if (!node) throw new RangeError(`Unknown path node: ${nodeId}`);
  if (state.path.includes(nodeId)) return 'taken';
  if (state.level < MONK_PATH.rowLevels[node.row - 1]) return 'level';
  const previous = MONK_PATH.nodes.find(n => n.branch === node.branch && n.row === node.row - 1);
  if (previous && !state.path.includes(previous.id)) return 'order';
  return 'available';
}

export function canSpendPoint(state, nodeId) {
  if (!nodeById(nodeId)) return { ok: false, reason: 'unknown' };
  const status = pathNodeStatus(state, nodeId);
  if (status !== 'available') return { ok: false, reason: status };
  if (unspentPoints(state) < 1) return { ok: false, reason: 'no-points' };
  return { ok: true };
}

export function spendPoint(state, nodeId) {
  const result = canSpendPoint(state, nodeId);
  if (result.ok) state.path = [...state.path, nodeId];
  return result;
}

// Free and refunds every point, but only out of combat (no pack pursues the monk).
export function respec(state, { inCombat = false } = {}) {
  if (inCombat) return { ok: false, reason: 'in-combat', refunded: 0 };
  const refunded = state.path.length;
  state.path = [];
  return { ok: true, refunded };
}

// Level and path stats. `damage` is the level part of the damage formula only.
export function progressionStats(state) {
  const { base, perLevel } = PROGRESSION_RULES, gained = state.level - 1;
  const stats = {
    level: state.level,
    maxHp: base.maxHp + perLevel.maxHp * gained,
    maxSpirit: base.maxSpirit + perLevel.maxSpirit * gained,
    damage: 1 + perLevel.damage * gained,
    points: unspentPoints(state),
    pickupHeal: MONK_RULES.pickup.amount,
    blockedStrikeSpirit: MONK_RULES.spirit.perBlockedStrike,
    damageTaken: 1, techniqueCost: 1, killSpirit: 0, lastBreath: null,
  };
  for (const { effect } of takenNodes(state)) {
    for (const [key, value] of Object.entries(effect)) {
      if (key === 'damage') continue;
      if (key === 'maxHp' || key === 'maxSpirit' || key === 'killSpirit') stats[key] += value;
      else if (key === 'damageTaken' || key === 'techniqueCost') stats[key] *= value;
      else stats[key] = value;
    }
  }
  return stats;
}

// Level and path part of monk damage for one hit. Weapon power and item affixes multiply on top.
// source: 'combo' | 'dash' | 'technique'; windup: the target is winding up an attack;
// finisher: the last strike of the combo; targetHpFraction: target health before the hit.
export function damageMultiplier(state, { source = 'combo', windup = false, finisher = false,
  targetHpFraction = 1 } = {}) {
  const applies = damage => (!damage.sources || damage.sources.includes(source)) && (!damage.condition
    || (damage.condition === 'windup' && windup)
    || (damage.condition === 'finisher' && finisher)
    || (damage.condition === 'lowHp' && targetHpFraction < damage.hpBelow));
  let multiplier = progressionStats(state).damage;
  for (const { effect: { damage } } of takenNodes(state)) if (damage && applies(damage)) multiplier *= damage.multiplier;
  return multiplier;
}

export function monsterLevelForZone(zoneId) {
  return PROGRESSION_RULES.zoneMonsterLevel[zoneId] ?? 1;
}

export function monsterLevelMultipliers(monsterLevel = 1) {
  const steps = monsterLevel - 1, { hp, damage, xp } = PROGRESSION_RULES.monsterLevel;
  return { hp: 1 + hp * steps, damage: 1 + damage * steps, xp: 1 + xp * steps };
}

export function scaleMonsterHp(base, monsterLevel = 1) {
  return Math.round(base * monsterLevelMultipliers(monsterLevel).hp);
}

export function scaleMonsterDamage(base, monsterLevel = 1) {
  return Math.round(base * monsterLevelMultipliers(monsterLevel).damage);
}
