import test from 'node:test';
import assert from 'node:assert/strict';
import { MONK_RULES } from '../src/monk-combat.js';
import { WRAITH_STATS } from '../src/campaign.js';
import {
  SLOTS, TECHNIQUE_SLOTS, SKILLS, TECHNIQUES, SPIRIT_ECONOMY, SHELL_LABELS, shellLabel,
  unlockedTechniques, unlockedSlots, unlocksAtLevel, techniqueParams, beetleHit,
  createLoadout, slotOf, techniqueStatus, learnTechniques, assignToSlot, chooseModifier, fullCooldown, canCast,
} from '../src/skills.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const deepFreeze = value => { Object.values(value).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(value); };
const levelFive = () => learnTechniques(createLoadout(), 1, 5).loadout;

test('five slots follow §2.1: LMB, Space, RMB from level 1, Q at level 2, F at level 4', () => {
  assert.deepEqual(SLOTS.map(s => [s.id, s.label, s.accepts, s.unlockLevel]), [
    ['lmb', 'ЛКМ', 'combo', 1], ['space', 'Пробел', 'dash', 1], ['rmb', 'ПКМ', 'technique', 1],
    ['q', 'Q', 'technique', 2], ['f', 'F', 'technique', 4],
  ]);
  assert.deepEqual(SLOTS.map(s => s.code ?? `button${s.button}`), ['button0', 'Space', 'button2', 'KeyQ', 'KeyF']);
  assert.deepEqual(TECHNIQUE_SLOTS, ['rmb', 'q', 'f']);
  assert.deepEqual([1, 2, 3, 4, 10].map(level => unlockedSlots(level).length), [3, 4, 4, 5, 5]);
  assert.ok(Object.isFrozen(SLOTS[0]) && Object.isFrozen(SKILLS.palm.modifiers[0].changes));
});

test('the base set reads its numbers from MONK_RULES (§2.2)', () => {
  assert.equal(SKILLS.combo.base.damage, MONK_RULES.combo.damage, 'the combo shares the frozen table');
  const combo = techniqueParams('combo');
  assert.deepEqual(combo.damage, [24, 30, 48]); assert.deepEqual(combo.range, [1.5, 1.6, 1.9]);
  assert.deepEqual(combo.dot.map(dot => Math.round(Math.acos(dot) * 180 / Math.PI)), [78, 87, 96]);
  assert.equal(combo.spiritPerStrike, 12); assert.equal(combo.spiritPerBlockedStrike, 4);
  assert.equal(SKILLS.combo.modifiers.length, 0, 'the weapon changes the combo, not a modifier');
  const dash = techniqueParams('dash');
  assert.deepEqual([dash.cost, dash.cooldown, dash.damage, dash.knockback, dash.invulnerable], [0, 1.2, 32, .15, true]);
  close(dash.speed * dash.duration, 3.2); close(dash.duration, .2);
  const wave = techniqueParams('wave');
  assert.deepEqual([wave.cost, wave.cooldown, wave.damage, wave.radius, wave.knockback], [40, 1.2, 72, 3.4, .9]);
  for (const id of ['dash', 'wave']) for (const key of Object.keys(MONK_RULES[id])) assert.equal(SKILLS[id].base[key], MONK_RULES[id][key]);
});

test('new techniques carry the §2.3 cost, cooldown, damage and zone', () => {
  const pick = (id, keys) => keys.map(key => techniqueParams(id)[key]);
  assert.deepEqual(pick('palm', ['cost', 'cooldown', 'damage', 'speed', 'range', 'knockback']), [20, .5, 40, 12, 7, .3]);
  assert.deepEqual(pick('crane', ['cost', 'cooldown', 'damage', 'minRange', 'range', 'flightTime', 'radius', 'knockback']),
    [30, 4, 56, 1.5, 5, .4, 1.6, .5]);
  assert.deepEqual(pick('deflect', ['cost', 'spiritOnSuccess', 'cooldown', 'damage', 'window', 'stun', 'reflectDamage', 'whiffLockout']),
    [0, 20, 3, 60, .4, .6, 40, .35]);
  assert.deepEqual(pick('bell', ['cost', 'cooldown', 'damage', 'chimes', 'radius', 'castRange', 'maxActive', 'stun']),
    [35, 6, 44, [.5, 1.5], 2.4, 6, 1, .6]);
  assert.deepEqual(pick('mantra', ['cost', 'cooldown', 'auraDamageReduction', 'burstDamageReduction', 'burstDuration']),
    [25, 12, .08, .32, 4]);
  assert.deepEqual(pick('sevenStrikes', ['cost', 'cooldown', 'hits', 'damage', 'interval', 'radius', 'invulnerableTime']),
    [60, 14, 7, 30, .1, 4.5, .7]);
  assert.deepEqual(TECHNIQUES.map(id => SKILLS[id].name), ['Волна духа', 'Ладонь духа', 'Прыжок журавля',
    'Отражение', 'Колокол тишины', 'Мантра стойкости', 'Семь ударов']);
  assert.deepEqual(TECHNIQUES.filter(id => techniqueParams(id).castDuringDash), ['deflect'], 'only deflect starts during a dash');
  const palm = techniqueParams('palm');
  assert.ok(palm.range > WRAITH_STATS.attackRange, 'the palm outranges the shooting spirit');
  assert.ok(2 * palm.damage >= MONK_RULES.enemyHp.wraith, 'two palms kill a shooting spirit at level 1');
});

test('levels unlock techniques, slots and modifiers per §2.7', () => {
  const table = {
    1: [['wave'], ['lmb', 'space', 'rmb'], []], 2: [['palm'], ['q'], []], 3: [[], [], ['dash', 'wave']],
    4: [['crane'], ['f'], ['palm']], 5: [['deflect'], [], []], 6: [['bell'], [], ['crane', 'deflect']],
    7: [['mantra'], [], ['bell']], 8: [[], [], ['mantra']], 9: [['sevenStrikes'], [], []], 10: [[], [], ['sevenStrikes']],
  };
  for (const [level, [techniques, slots, modifiers]] of Object.entries(table)) {
    assert.deepEqual(unlocksAtLevel(Number(level)), { techniques, slots, modifiers }, `level ${level}`);
  }
  assert.deepEqual(unlockedTechniques(1), ['wave']);
  assert.deepEqual(unlockedTechniques(4), ['wave', 'palm', 'crane']);
  assert.deepEqual(unlockedTechniques(5), ['wave', 'palm', 'crane', 'deflect']);
  assert.deepEqual(unlockedTechniques(10), TECHNIQUES);
});

const MODIFIED = {
  doubleStep: ['dash', 'Двойной шаг', { charges: 2, cooldown: 1.6, damage: 24 }],
  crushingStep: ['dash', 'Сокрушающий шаг', { damage: 60, knockback: .6, cooldown: 2.2 }],
  spiritStep: ['dash', 'Шаг духа', { spiritPerHit: 6, spiritCap: 18, damage: 32 }],
  heavyWave: ['wave', 'Тяжёлая волна', { radius: 2.6, damage: 110, knockback: 1.4, cost: 40 }],
  vortexWave: ['wave', 'Вихревая волна', { pullRadius: 4.4, pullTo: .9, damage: 48, shellBreak: true }],
  calmWave: ['wave', 'Волна покоя', { healPerHit: 4, healCap: 20, damage: 60 }],
  piercingPalm: ['palm', 'Пронзающая ладонь', { pierce: true, damage: 32 }],
  explodingPalm: ['palm', 'Взрывная ладонь', { markDuration: 3, explosionRadius: 2, explosionDamage: 40, damage: 40 }],
  palmFan: ['palm', 'Веер ладоней', { projectiles: 3, spreadDegrees: 14, damage: 24, cost: 26 }],
  mountainFall: ['crane', 'Падение горы', { radius: 2.4, damage: 80, cooldown: 6 }],
  lightCrane: ['crane', 'Лёгкий журавль', { cost: 12, range: 6.5, damage: 30 }],
  shatteringLanding: ['crane', 'Раскалывающее приземление', { shellBreak: true, damage: 44 }],
  spiritRiposte: ['deflect', 'Ответный дух', { spiritOnSuccess: 35, resetsDash: true }],
  wideStance: ['deflect', 'Широкая стойка', { window: .65, damage: 36, reflectDamage: 40 }],
  circularRiposte: ['deflect', 'Круговой ответ', { riposteRadius: 1.8, damage: 45 }],
  beaconBell: ['bell', 'Колокол-маяк', { lureDuration: 2, lureRadius: 4.5, lureKinds: ['hound', 'beetle'], damage: 30 }],
  tripleChime: ['bell', 'Тройной звон', { chimes: [.5, 1.3, 2.1], damage: 36, cost: 40 }],
  calmBell: ['bell', 'Колокол покоя', { healPerChime: 8, damage: 36 }],
  retribution: ['mantra', 'Воздаяние', { retaliationDamage: 15, burstDamage: 45, burstStun: .4, auraDamageReduction: 0, burstDamageReduction: 0 }],
  healing: ['mantra', 'Исцеление', { auraHealPerSecond: 1, burstHealPerSecond: 6, auraDamageReduction: 0, burstDamageReduction: 0 }],
  clarity: ['mantra', 'Ясность', { auraSpiritPerStrike: 2, burstSpiritPerSecond: 6, auraDamageReduction: 0 }],
  nineStrikes: ['sevenStrikes', 'Девять ударов', { hits: 9, damage: 26 }],
  finalStrike: ['sevenStrikes', 'Последний удар', { finalHitMultiplier: 3, shellBreak: 'finalStrike', damage: 30 }],
  stunningStrikes: ['sevenStrikes', 'Оглушающие удары', { stun: 1, stunKinds: ['hound', 'wraith'], damage: 24 }],
};

test('every skill except the combo has the three §2.6 modifiers, with valid keys', () => {
  for (const entry of Object.values(SKILLS).filter(e => e.id !== 'combo')) {
    const expected = Object.entries(MODIFIED).filter(([, [skillId]]) => skillId === entry.id);
    assert.deepEqual(entry.modifiers.map(m => [m.id, m.name]), expected.map(([id, [, name]]) => [id, name]), entry.id);
    for (const { id, changes } of entry.modifiers) {
      for (const key of Object.keys(changes)) assert.ok(key in entry.base, `${id}.${key} must replace a base value`);
    }
  }
  const ids = Object.values(SKILLS).flatMap(e => e.modifiers.map(m => m.id));
  assert.equal(new Set(ids).size, 24);
});

test('a modifier resolves to the §2.6 numbers and leaves the rest of the skill alone', () => {
  for (const [modifier, [skillId, , values]] of Object.entries(MODIFIED)) {
    const params = techniqueParams(skillId, modifier);
    for (const [key, value] of Object.entries(values)) assert.deepEqual(params[key], value, `${modifier}.${key}`);
  }
  assert.equal(techniqueParams('wave', 'vortexWave').radius, 3.4);
  assert.equal(techniqueParams('palm', 'palmFan').range, 7);
  assert.equal(techniqueParams('mantra').auraDamageReduction, .08, 'no modifier keeps «Стойкость»');
  assert.equal(techniqueParams('palm', undefined).damage, 40);
  assert.throws(() => techniqueParams('palm', 'heavyWave'), /no modifier/);
  assert.throws(() => techniqueParams('combo', 'doubleStep'), /no modifier/);
  assert.throws(() => techniqueParams('fireball'), /Unknown skill/);
});

test('spirit costs and gains follow §2.5', () => {
  assert.equal(SPIRIT_ECONOMY.initial, 60);
  assert.deepEqual(SPIRIT_ECONOMY.gain, { strike: 12, blockedStrike: 4, deflect: 20, spiritStepPerHit: 6, spiritStepCap: 18 });
  assert.deepEqual(SPIRIT_ECONOMY.cost, { wave: 40, palm: 20, crane: 30, deflect: 0, bell: 35, mantra: 25, sevenStrikes: 60 });
  // Strikes before a cast: knuckles earn 10 a strike, the staff 14 (§3.2).
  const strikes = { wave: [4, 3], palm: [2, 2], crane: [3, 3], bell: [4, 3], mantra: [3, 2], sevenStrikes: [6, 5] };
  for (const [id, expected] of Object.entries(strikes)) {
    assert.deepEqual([10, 14].map(gain => Math.ceil(SPIRIT_ECONOMY.cost[id] / gain)), expected, id);
  }
  const combo = techniqueParams('combo');
  assert.equal(Math.round(combo.damage.length * combo.spiritPerStrike / combo.duration.reduce((a, b) => a + b) * 10) / 10, 46.8);
  assert.equal(techniqueParams('deflect', 'spiritRiposte').spiritOnSuccess, 35);
});

test('scaled damage matches the §6.3 step and technique table', () => {
  // §6.1 without affixes: level bonus 4% a level, weapon power 10% an item level.
  const scale = (level, itemLevel) => (1 + .04 * (level - 1)) * (1 + .1 * (itemLevel - 1));
  const points = [[1, 1], [5, 2], [10, 8]];
  const table = {
    wave: [72, 92, 166], dash: [32, 41, 74], palm: [40, 51, 92],
    crane: [56, 71, 129], bell: [44, 56, 102], deflect: [60, 77, 139],
  };
  for (const [id, expected] of Object.entries(table)) {
    assert.deepEqual(points.map(([level, ilvl]) => techniqueParams(id, null, { damage: scale(level, ilvl) }).damage), expected, id);
  }
  // A wave kills a hound in one hit at all three points (hound hp 64 / 76 / 156).
  assert.deepEqual(table.wave.map((damage, i) => damage >= [64, 76, 156][i]), [true, true, true]);
  assert.deepEqual(techniqueParams('combo', null, { damage: 1 }).damage, [24, 30, 48]);
  assert.deepEqual(techniqueParams('combo', null, { damage: scale(10, 8) * 1.22 }).damage, [68, 85, 135]);
  const scaled = techniqueParams('palm', 'explodingPalm', { damage: 1.5, cooldown: .94, cost: .85 });
  assert.deepEqual([scaled.damage, scaled.explosionDamage, scaled.cost], [60, 60, 17]);
  close(scaled.cooldown, .47);
  assert.equal(techniqueParams('deflect', null, { damage: 2 }).reflectDamage, 80);
  assert.deepEqual(['retaliationDamage', 'burstDamage'].map(k => techniqueParams('mantra', 'retribution', { damage: 2 })[k]), [30, 90]);
});

test('beetle block and break follow §2.4 for every skill', () => {
  const hit = (id, modifier, context) => beetleHit(techniqueParams(id, modifier), context);
  const rows = [
    ['combo', null, { front: true, damage: 24 }, [6, true, false]],
    ['combo', null, { damage: 48 }, [48, false, false]],
    ['dash', null, { front: true }, [32, false, true]],
    ['dash', null, { front: true, breakImmune: true }, [8, true, false]],
    ['wave', null, { front: true }, [72, false, true]],
    ['wave', 'vortexWave', { front: true }, [48, false, true]],
    ['palm', null, { front: true }, [10, true, false]],
    ['palm', null, {}, [40, false, false]],
    ['palm', 'piercingPalm', { front: true }, [8, true, false]],
    ['crane', null, { front: true }, [14, true, false]],
    ['crane', null, {}, [56, false, false]],
    ['crane', 'shatteringLanding', { front: true }, [44, false, true]],
    ['deflect', null, { front: true }, [15, true, false]],
    ['deflect', null, { front: true, deflectedSlam: true }, [60, false, true]],
    ['bell', null, { front: true }, [11, true, false]],
    ['mantra', 'retribution', { front: true, damage: 15 }, [15, false, false]],
    ['sevenStrikes', null, { front: true }, [30, false, false]],
    ['sevenStrikes', 'finalStrike', { front: true }, [30, false, false]],
    ['sevenStrikes', 'finalStrike', { front: true, finalStrike: true, damage: 90 }, [90, false, true]],
    ['palm', null, { front: true, exposed: true }, [40, false, false]],
    ['wave', null, { front: true, exposed: true }, [72, false, false]],
  ];
  for (const [id, modifier, context, [damage, blocked, breaks]] of rows) {
    assert.deepEqual(hit(id, modifier, context), { damage, blocked, breaks }, `${id}/${modifier} ${JSON.stringify(context)}`);
  }
  const breakers = Object.keys(SKILLS).filter(id => techniqueParams(id).shellBreak !== false);
  assert.deepEqual(breakers, ['dash', 'wave', 'deflect'], 'only dash, wave and a deflected slam break the shell');
  const labels = ['combo', 'dash', 'wave', 'palm', 'crane', 'deflect', 'bell', 'mantra', 'sevenStrikes']
    .map(id => SHELL_LABELS[shellLabel(techniqueParams(id))]);
  assert.deepEqual(labels, ['Блок спереди', 'Раскалывает', 'Раскалывает', 'Блок спереди', 'От точки удара',
    'Раскалывает', 'От точки удара', 'Полный урон', 'Полный урон']);
  assert.equal(shellLabel(techniqueParams('crane', 'shatteringLanding')), 'break');
  assert.equal(shellLabel(techniqueParams('sevenStrikes', 'finalStrike')), 'break');
});

test('a new run starts with the combo, the dash and the wave on RMB', () => {
  const loadout = createLoadout();
  assert.deepEqual(Object.keys(loadout.slots), SLOTS.map(s => s.id));
  assert.deepEqual(loadout, { slots: { lmb: 'combo', space: 'dash', rmb: 'wave', q: null, f: null }, modifiers: {} });
  assert.notEqual(createLoadout().slots, loadout.slots, 'each run gets its own loadout');
  assert.equal(slotOf(loadout, 'wave'), 'rmb'); assert.equal(slotOf(loadout, 'palm'), null); assert.equal(slotOf(loadout, null), null);
});

test('a learned technique takes the first empty slot, otherwise stays unslotted (§2.1, §2.9.3)', () => {
  let loadout = deepFreeze(createLoadout());
  const steps = [];
  for (let level = 2; level <= 5; level++) {
    const result = learnTechniques(loadout, level - 1, level);
    steps.push(...result.learned); loadout = deepFreeze(result.loadout);
  }
  assert.deepEqual(steps, [{ technique: 'palm', slot: 'q' }, { technique: 'crane', slot: 'f' }, { technique: 'deflect', slot: null }]);
  assert.deepEqual(learnTechniques(createLoadout(), 1, 5), { loadout, learned: steps }, 'a level jump learns the same way');
  assert.deepEqual(loadout.slots, { lmb: 'combo', space: 'dash', rmb: 'wave', q: 'palm', f: 'crane' });
  // §5.8 board, level 5: wave, palm, crane slotted; deflect unslotted; later techniques locked.
  assert.deepEqual(TECHNIQUES.map(id => techniqueStatus(loadout, id, 5)),
    ['slotted', 'slotted', 'slotted', 'unslotted', 'locked', 'locked', 'locked']);
  const late = learnTechniques(loadout, 5, 9);
  assert.deepEqual(late.learned.map(l => l.slot), [null, null, null]);
  assert.equal(slotOf(late.loadout, 'mantra'), null, 'an unslotted mantra has no aura');
  assert.deepEqual(learnTechniques(loadout, 5, 5).learned, []);
});

test('slotting replaces or swaps techniques and restarts their cooldown (§2.8, §2.9)', () => {
  const loadout = deepFreeze(levelFive());
  const placed = assignToSlot(loadout, 'q', 'deflect', { level: 5, inCombat: true });
  assert.equal(placed.ok, true, 'swaps are allowed in combat');
  assert.deepEqual(placed.loadout.slots, { ...loadout.slots, q: 'deflect' });
  assert.deepEqual(placed.restarted, ['deflect']);
  assert.equal(techniqueStatus(placed.loadout, 'palm', 5), 'unslotted');
  const swapped = assignToSlot(loadout, 'rmb', 'crane', { level: 5 });
  assert.deepEqual(swapped.loadout.slots, { ...loadout.slots, rmb: 'crane', f: 'wave' });
  assert.deepEqual(swapped.restarted, ['crane', 'wave']);
  assert.ok(TECHNIQUES.every(id => techniqueStatus(swapped.loadout, id, 5) === techniqueStatus(loadout, id, 5)), 'a swap unslots nothing');
  assert.deepEqual(assignToSlot(loadout, 'q', 'palm', { level: 5 }), { ok: true, loadout, restarted: [] });
  assert.deepEqual(loadout.slots, levelFive().slots, 'the input loadout is unchanged');
});

test('slotting rejects locked slots, locked techniques and the fixed slots', () => {
  const start = createLoadout(), five = levelFive();
  const reason = (...args) => assignToSlot(...args).reason;
  assert.equal(reason(start, 'q', 'wave', { level: 1 }), 'slot-locked');
  assert.equal(reason(start, 'f', 'palm', { level: 3 }), 'slot-locked');
  assert.equal(reason(start, 'rmb', 'palm', { level: 1 }), 'technique-locked');
  assert.equal(reason(five, 'rmb', 'bell', { level: 5 }), 'technique-locked');
  assert.equal(reason(five, 'lmb', 'palm', { level: 5 }), 'not-technique-slot');
  assert.equal(reason(five, 'space', 'deflect', { level: 5 }), 'not-technique-slot');
  assert.equal(reason(five, 'rmb', 'dash', { level: 5 }), 'not-technique');
  assert.equal(reason(five, 'rmb', 'combo', { level: 5 }), 'not-technique');
  assert.equal(reason(five, 'rmb', null, { level: 5 }), 'not-technique', 'a slot cannot be emptied');
  assert.equal(assignToSlot(start, 'rmb', 'palm', { level: 2 }).ok, true);
});

test('modifiers unlock by level, restart the skill and survive unslotting', () => {
  let loadout = deepFreeze(levelFive());
  assert.equal(chooseModifier(loadout, 'dash', 'doubleStep', { level: 2 }).reason, 'modifier-locked');
  assert.equal(chooseModifier(loadout, 'deflect', 'wideStance', { level: 5 }).reason, 'modifier-locked');
  assert.equal(chooseModifier(loadout, 'combo', null, { level: 10 }).reason, 'no-modifiers');
  assert.equal(chooseModifier(loadout, 'dash', 'heavyWave', { level: 10 }).reason, 'unknown-modifier');
  const step = chooseModifier(loadout, 'dash', 'doubleStep', { level: 3 });
  assert.deepEqual(step.restarted, ['dash']); assert.equal(step.loadout.modifiers.dash, 'doubleStep');
  assert.deepEqual(chooseModifier(step.loadout, 'dash', 'doubleStep', { level: 3 }).restarted, []);
  assert.deepEqual(chooseModifier(step.loadout, 'dash', 'spiritStep', { level: 3 }).loadout.modifiers, { dash: 'spiritStep' });
  const cleared = chooseModifier(step.loadout, 'dash', null, { level: 3 });
  assert.deepEqual(cleared.restarted, ['dash']); assert.equal(cleared.loadout.modifiers.dash, null);
  assert.deepEqual(loadout.modifiers, {}, 'the input loadout is unchanged');
  // An unslotted technique keeps its modifier through slotting in and out (§2.9.2).
  loadout = chooseModifier(loadout, 'deflect', 'wideStance', { level: 6 }).loadout;
  loadout = assignToSlot(loadout, 'q', 'deflect', { level: 6 }).loadout;
  loadout = assignToSlot(loadout, 'q', 'palm', { level: 6 }).loadout;
  assert.equal(techniqueStatus(loadout, 'deflect', 6), 'unslotted');
  assert.equal(loadout.modifiers.deflect, 'wideStance');
});

test('canCast checks the slotted skill, its modifier cost, its cooldown and the dash', () => {
  let loadout = levelFive();
  assert.equal(canCast(loadout, 'rmb', { spirit: 40 }), true);
  assert.equal(canCast(loadout, 'rmb', { spirit: 39 }), false);
  assert.equal(canCast(loadout, 'rmb', { spirit: 100, cooldowns: { wave: .2 } }), false);
  assert.equal(canCast(loadout, 'rmb', { spirit: 100, cooldowns: { wave: 1e-12, palm: 5 } }), true);
  assert.equal(canCast(createLoadout(), 'q', { spirit: 100 }), false, 'an empty slot cannot cast');
  assert.equal(canCast(loadout, 'lmb', { spirit: 0 }), true);
  assert.equal(canCast(loadout, 'space', { spirit: 0, dashing: true }), false);
  loadout = chooseModifier(loadout, 'palm', 'palmFan', { level: 5 }).loadout;
  assert.equal(canCast(loadout, 'q', { spirit: 25 }), false, 'the fan costs 26');
  assert.equal(canCast(loadout, 'q', { spirit: 26 }), true);
  assert.equal(canCast(loadout, 'q', { spirit: 25, scale: { cost: .85 } }), true);
  loadout = chooseModifier(loadout, 'crane', 'lightCrane', { level: 6 }).loadout;
  assert.equal(canCast(loadout, 'f', { spirit: 12 }), true);
  // Only deflect starts during a dash.
  const deflecting = assignToSlot(loadout, 'rmb', 'deflect', { level: 6 }).loadout;
  assert.equal(canCast(deflecting, 'rmb', { spirit: 0, dashing: true }), true);
  assert.equal(canCast(deflecting, 'q', { spirit: 100, dashing: true }), false);
  // Double step: the cooldown is recharge debt, ready while one of two charges remains.
  const double = chooseModifier(loadout, 'dash', 'doubleStep', { level: 3 }).loadout;
  const params = techniqueParams('dash', 'doubleStep');
  assert.equal(fullCooldown(params), 3.2); assert.equal(fullCooldown(techniqueParams('wave')), 1.2);
  assert.equal(canCast(double, 'space', { spirit: 0, cooldowns: { dash: 1.6 } }), true);
  assert.equal(canCast(double, 'space', { spirit: 0, cooldowns: { dash: 1.7 } }), false);
  assert.equal(canCast(loadout, 'space', { spirit: 0, cooldowns: { dash: .1 } }), false);
});
