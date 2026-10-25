import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure } from '../src/game.js';
import { DEFAULT_WORLD_SEED } from '../src/overworld.js';
import {
  PROGRESSION_RULES, MONK_PATH, createProgression, resetProgression, levelForXp, grantXp, xpProgress,
  xpReward, pointsEarned, unspentPoints, pathNodeStatus, canSpendPoint, spendPoint, respec,
  progressionStats, damageMultiplier, monsterLevelForZone, monsterLevelMultipliers,
  scaleMonsterHp, scaleMonsterDamage,
} from '../src/progression.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const atLevel = level => {
  const state = createProgression();
  grantXp(state, PROGRESSION_RULES.levelXp[level - 1]);
  return state;
};
const isDeepFrozen = value => !value || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

test('rule tables are deeply frozen', () => {
  assert.ok(isDeepFrozen(PROGRESSION_RULES));
  assert.ok(isDeepFrozen(MONK_PATH));
});

test('level curve matches the §4.2 table', () => {
  const { levelXp, maxLevel } = PROGRESSION_RULES;
  assert.equal(maxLevel, 10);
  assert.deepEqual([...levelXp], [0, 80, 220, 450, 840, 1510, 2650, 4580, 7860, 13440]);
  assert.deepEqual(levelXp.slice(1).map((xp, i) => xp - levelXp[i]), [80, 140, 230, 390, 670, 1140, 1930, 3280, 5580]);
  for (const [xp, level] of [[0, 1], [79, 1], [80, 2], [219, 2], [220, 3], [449, 3], [450, 4],
    [839, 4], [840, 5], [1509, 5], [1510, 6], [2649, 6], [2650, 7], [4579, 7], [4580, 8],
    [7859, 8], [7860, 9], [13439, 9], [13440, 10], [99999, 10]]) assert.equal(levelForXp(xp), level, `${xp} xp`);
});

test('every level grants +8 health, +5 spirit, +4% damage and one path point', () => {
  const table = [
    [1, 100, 100, 1.00], [2, 108, 105, 1.04], [3, 116, 110, 1.08], [4, 124, 115, 1.12], [5, 132, 120, 1.16],
    [6, 140, 125, 1.20], [7, 148, 130, 1.24], [8, 156, 135, 1.28], [9, 164, 140, 1.32], [10, 172, 145, 1.36],
  ];
  for (const [level, maxHp, maxSpirit, damage] of table) {
    const stats = progressionStats(atLevel(level));
    assert.equal(stats.level, level);
    assert.equal(stats.maxHp, maxHp);
    assert.equal(stats.maxSpirit, maxSpirit);
    close(stats.damage, damage);
    assert.equal(stats.points, level - 1);
    assert.equal(pointsEarned(level), level - 1);
  }
});

test('experience sources match §4.1 for monster levels 1 and 2', () => {
  for (const [source, ml1, ml2] of [['hound', 10, 13], ['wraith', 14, 18], ['beetle', 30, 38],
    ['pack', 15, 15], ['secret', 60, 60], ['ritual', 60, 60], ['shrine', 0, 0]]) {
    assert.equal(xpReward(source, 1), ml1, `${source} at ML 1`);
    assert.equal(xpReward(source, 2), ml2, `${source} at ML 2`);
  }
  assert.equal(xpReward('hound'), 10);
  assert.throws(() => xpReward('dragon'), RangeError);
  assert.throws(() => xpReward('toString'), RangeError);
});

// Region 1 in walking order: packs and wander groups by their centre, north to south, then the
// ritual. The full clear adds the side trail (road-thicket, side wanderers, the cache after the
// thicket). Wanderers give kill experience only, without the pack bonus. Region 1 is the road and
// the courtyard; the cemetery and the orchard are optional (side-balance.test.js).
function routeSteps(enemies, zoneIds, keep = () => true) {
  const groups = new Map();
  for (const e of enemies) if (e.packId && zoneIds.includes(e.zoneId)) groups.set(e.packId, [...groups.get(e.packId) ?? [], e]);
  return [...groups].filter(([id, members]) => keep(id, members))
    .map(([id, members]) => ({ id, y: members.reduce((sum, e) => sum + e.y, 0) / members.length,
      xp: members.reduce((sum, e) => sum + xpReward(e.kind, monsterLevelForZone(e.zoneId)),
        members[0].wander ? 0 : xpReward('pack')) }))
    .sort((a, b) => b.y - a.y);
}
function regionRoute(enemies, full) {
  const steps = routeSteps(enemies, ['road', 'courtyard'], (id, members) => full || (id !== 'road-thicket' && !members[0].side));
  if (full) steps.splice(steps.findIndex(step => step.id === 'road-thicket') + 1, 0, { id: 'secret', xp: xpReward('secret') });
  return [...steps, { id: 'ritual', xp: xpReward('ritual') }];
}
// The full clear with both side zones (world-expansion §5.6): the cemetery and its cache before
// road-crossing, the orchard and its cache after court-entrance.
function fullRoute(enemies) {
  const steps = regionRoute(enemies, true);
  steps.splice(steps.findIndex(step => step.id === 'road-crossing'), 0,
    ...routeSteps(enemies, ['cemetery']), { id: 'cemetery-cache', xp: xpReward('secret') });
  steps.splice(steps.findIndex(step => step.id === 'court-entrance') + 1, 0,
    ...routeSteps(enemies, ['orchard']), { id: 'orchard-cache', xp: xpReward('secret') });
  return steps;
}
const walkRoute = steps => {
  const state = createProgression();
  return steps.map(step => {
    const events = grantXp(state, step.xp);
    return [step.id, state.xp, state.level, events.map(e => e.level)];
  });
};

test('region 1 route of the default seed matches the expanded-world tables', () => {
  const enemies = createAdventure().enemies;
  const expected = [
  [
    [
      "road-approach",
      107
    ],
    [
      "wander-8",
      117
    ],
    [
      "road-crossing",
      230
    ],
    [
      "wander-7",
      240
    ],
    [
      "wander-6",
      250
    ],
    [
      "road-gate",
      379
    ],
    [
      "court-entrance",
      525
    ],
    [
      "wander-5",
      543
    ],
    [
      "wander-4",
      561
    ],
    [
      "court-source",
      740
    ],
    [
      "wander-3",
      766
    ],
    [
      "ritual",
      826
    ]
  ],
  [
    [
      "road-approach",
      107
    ],
    [
      "wander-8",
      117
    ],
    [
      "wander-10",
      151
    ],
    [
      "road-thicket",
      294
    ],
    [
      "secret",
      354
    ],
    [
      "wander-9",
      364
    ],
    [
      "road-crossing",
      477
    ],
    [
      "wander-2",
      497
    ],
    [
      "wander-1",
      517
    ],
    [
      "wander-7",
      527
    ],
    [
      "wander-6",
      537
    ],
    [
      "road-gate",
      666
    ],
    [
      "court-entrance",
      812
    ],
    [
      "wander-5",
      830
    ],
    [
      "wander-4",
      848
    ],
    [
      "court-source",
      1027
    ],
    [
      "wander-3",
      1053
    ],
    [
      "ritual",
      1113
    ]
  ],
  [
    [
      "road-approach",
      107
    ],
    [
      "wander-8",
      117
    ],
    [
      "wander-10",
      151
    ],
    [
      "road-thicket",
      294
    ],
    [
      "secret",
      354
    ],
    [
      "wander-9",
      364
    ],
    [
      "side-wander-3",
      390
    ],
    [
      "cemetery-graves",
      536
    ],
    [
      "side-wander-1",
      562
    ],
    [
      "side-wander-2",
      598
    ],
    [
      "cemetery-obelisk",
      807
    ],
    [
      "cemetery-cache",
      867
    ],
    [
      "road-crossing",
      980
    ],
    [
      "wander-2",
      1000
    ],
    [
      "wander-1",
      1020
    ],
    [
      "wander-7",
      1030
    ],
    [
      "wander-6",
      1040
    ],
    [
      "road-gate",
      1169
    ],
    [
      "court-entrance",
      1315
    ],
    [
      "orchard-press",
      1522
    ],
    [
      "side-wander-4",
      1543
    ],
    [
      "orchard-well",
      1801
    ],
    [
      "side-wander-5",
      1831
    ],
    [
      "orchard-cache",
      1891
    ],
    [
      "wander-5",
      1909
    ],
    [
      "wander-4",
      1927
    ],
    [
      "court-source",
      2106
    ],
    [
      "wander-3",
      2132
    ],
    [
      "ritual",
      2192
    ]
  ]
];
  const withLevels = rows => rows.map(([id, xp], i) => {
    const level = levelForXp(xp), previous = levelForXp(i ? rows[i - 1][1] : 0);
    return [id, xp, level, Array.from({ length: level - previous }, (_, j) => previous + j + 1)];
  });
  assert.deepEqual(walkRoute(regionRoute(enemies, false)), withLevels(expected[0]));
  assert.deepEqual(walkRoute(regionRoute(enemies, true)), withLevels(expected[1]));
  assert.deepEqual(walkRoute(fullRoute(enemies)), withLevels(expected[2]));
});

test('region 1 route experience stays in the §4.3 band across 200 seeds', () => {
  let seed = 4242;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const seeds = [0, 1, 4294967295, DEFAULT_WORLD_SEED, ...Array.from({ length: 196 }, next)];
  const totals = { main: [], full: [] };
  let fullBeforeSource = 0; const mainLevels = new Set();
  for (const runSeed of seeds) {
    const enemies = createAdventure({}, { seed: runSeed }).enemies;
    const main = walkRoute(regionRoute(enemies, false)), full = walkRoute(regionRoute(enemies, true));
    const [, mainXp, mainLevel] = main.at(-1), [, fullXp, fullLevel] = full.at(-1);
    // road-approach alone gives level 2: the first level comes in the first fight.
    assert.ok(main[0][0] === 'road-approach' && main[0][2] === 2, `${runSeed}: level 2 after road-approach`);
    totals.main.push(mainXp); totals.full.push(fullXp);
    assert.ok(mainLevel === levelForXp(mainXp) && mainXp >= 760 && mainXp <= 1000, `${runSeed}: main path ${mainXp}`);
    assert.ok(fullLevel === levelForXp(fullXp) && fullXp >= 1100 && fullXp <= 1300, `${runSeed}: full clear ${fullXp}`);
    mainLevels.add(mainLevel);
    if (full[full.findIndex(step => step[0] === 'court-source') - 1][2] >= levelForXp(840)) fullBeforeSource++;
  }
  const mean = list => list.reduce((sum, xp) => sum + xp, 0) / list.length;
  assert.ok(mean(totals.main) > 840 && mean(totals.main) < 880, `main path mean ${mean(totals.main)}`);
  assert.ok(mean(totals.full) > 1110 && mean(totals.full) < 1150, `full clear mean ${mean(totals.full)}`);
  assert.deepEqual([...mainLevels].sort(), [levelForXp(760), levelForXp(1000)]);
  assert.ok(fullBeforeSource >= .75 * seeds.length, `full clear level 5 before court-source in ${fullBeforeSource} runs`);
});

test('grantXp emits one level-up event per level and stops at the cap', () => {
  const state = createProgression();
  assert.deepEqual(grantXp(state, 79), []);
  assert.deepEqual(grantXp(state, 1), [{ type: 'level-up', level: 2, hp: 8, spirit: 5, points: 1, pathRow: 1 }]);
  const events = grantXp(state, 20000);
  assert.deepEqual(events.map(e => e.level), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(events.map(e => e.pathRow), [null, 2, null, 3, null, 4, null, null]);
  assert.ok(events.every(e => e.type === 'level-up' && e.hp === 8 && e.spirit === 5 && e.points === 1));
  assert.equal(state.xp, 13440);
  assert.deepEqual(grantXp(state, 100), []);
  assert.equal(state.xp, 13440);
  assert.deepEqual(grantXp(state, 0), []);
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => grantXp(state, bad), RangeError);
});

test('xpProgress reports the bar for the current level', () => {
  const state = createProgression();
  grantXp(state, 389);
  assert.deepEqual(xpProgress(state), { xp: 389, start: 220, next: 450, fraction: 169 / 230 });
  grantXp(state, 99999);
  assert.deepEqual(xpProgress(state), { xp: 13440, start: 13440, next: null, fraction: 1 });
});

test('the path is three branches of four rows with §4.5 row levels', () => {
  assert.deepEqual([...MONK_PATH.rowLevels], [2, 4, 6, 8]);
  assert.equal(MONK_PATH.nodes.length, 12);
  assert.equal(new Set(MONK_PATH.nodes.map(n => n.id)).size, 12);
  for (const branch of MONK_PATH.branches) {
    assert.deepEqual(MONK_PATH.nodes.filter(n => n.branch === branch).map(n => n.row), [1, 2, 3, 4]);
  }
});

test('path nodes need their row level, the previous node of the branch and a free point', () => {
  const state = atLevel(3);
  assert.equal(unspentPoints(state), 2);
  assert.equal(pathNodeStatus(state, 'tempering'), 'available');
  assert.equal(pathNodeStatus(state, 'second-wind'), 'level');
  assert.deepEqual(canSpendPoint(state, 'second-wind'), { ok: false, reason: 'level' });
  assert.deepEqual(canSpendPoint(state, 'meteor'), { ok: false, reason: 'unknown' });
  assert.throws(() => pathNodeStatus(state, 'meteor'), RangeError);
  assert.deepEqual(spendPoint(state, 'tempering'), { ok: true });
  assert.equal(pathNodeStatus(state, 'tempering'), 'taken');
  assert.deepEqual(spendPoint(state, 'tempering'), { ok: false, reason: 'taken' });
  assert.deepEqual(spendPoint(state, 'deep-breath'), { ok: true });
  assert.equal(unspentPoints(state), 0);
  assert.deepEqual(canSpendPoint(state, 'steady-hand'), { ok: false, reason: 'no-points' });

  grantXp(state, PROGRESSION_RULES.levelXp[3] - state.xp);
  assert.equal(state.level, 4);
  assert.equal(pathNodeStatus(state, 'intercept'), 'order');
  assert.deepEqual(spendPoint(state, 'intercept'), { ok: false, reason: 'order' });
  assert.deepEqual(spendPoint(state, 'second-wind'), { ok: true });
  assert.deepEqual(state.path, ['tempering', 'deep-breath', 'second-wind']);
  assert.equal(unspentPoints(state), 0);
});

test('level 10 gives nine points for nine of the twelve nodes', () => {
  const state = atLevel(10);
  const order = ['tempering', 'second-wind', 'stone-skin', 'last-breath',
    'deep-breath', 'resonance', 'calm-mind', 'flow', 'steady-hand'];
  for (const id of order) assert.deepEqual(spendPoint(state, id), { ok: true }, id);
  assert.equal(unspentPoints(state), 0);
  assert.deepEqual(canSpendPoint(state, 'intercept'), { ok: false, reason: 'no-points' });
});

test('path nodes change derived stats', () => {
  const state = atLevel(10);
  const { damage, ...plain } = progressionStats(state);
  close(damage, 1.36);
  assert.deepEqual(plain, {
    level: 10, maxHp: 172, maxSpirit: 145, points: 9, pickupHeal: 18, blockedStrikeSpirit: 4,
    damageTaken: 1, techniqueCost: 1, killSpirit: 0, lastBreath: null,
  });
  for (const id of ['tempering', 'second-wind', 'stone-skin', 'last-breath',
    'deep-breath', 'resonance', 'calm-mind', 'flow']) spendPoint(state, id);
  const stats = progressionStats(state);
  assert.equal(stats.maxHp, 172 + 15);
  assert.equal(stats.maxSpirit, 145 + 20);
  assert.equal(stats.pickupHeal, 26);
  assert.equal(stats.blockedStrikeSpirit, 8);
  close(stats.damageTaken, .9);
  close(stats.techniqueCost, .85);
  assert.equal(stats.killSpirit, 5);
  assert.deepEqual(stats.lastBreath, { hpBelow: .25, invulnerable: 1.5, cooldown: 60 });
  assert.equal(stats.points, 1);
});

test('damage multiplier combines the level bonus with matching strike nodes', () => {
  const state = atLevel(10);
  close(damageMultiplier(state), 1.36);
  for (const id of ['steady-hand', 'intercept', 'combo-finale', 'execution']) spendPoint(state, id);
  close(damageMultiplier(state), 1.36 * 1.08);
  close(damageMultiplier(state, { source: 'combo', finisher: true }), 1.36 * 1.08 * 1.25);
  close(damageMultiplier(state, { source: 'combo', windup: true }), 1.36 * 1.08 * 1.25);
  close(damageMultiplier(state, { source: 'combo', targetHpFraction: .19 }), 1.36 * 1.08 * 2);
  close(damageMultiplier(state, { source: 'combo', targetHpFraction: .2 }), 1.36 * 1.08);
  close(damageMultiplier(state, { source: 'combo', windup: true, finisher: true, targetHpFraction: .1 }),
    1.36 * 1.08 * 1.25 * 1.25 * 2);
  // Only Перехват reaches the dash and techniques.
  close(damageMultiplier(state, { source: 'dash', finisher: true, targetHpFraction: .1 }), 1.36);
  close(damageMultiplier(state, { source: 'technique', windup: true }), 1.36 * 1.25);
});

test('respec refunds every point for free, but never in combat', () => {
  const state = atLevel(5);
  for (const id of ['tempering', 'second-wind', 'steady-hand', 'deep-breath']) spendPoint(state, id);
  assert.equal(unspentPoints(state), 0);
  assert.deepEqual(respec(state, { inCombat: true }), { ok: false, reason: 'in-combat', refunded: 0 });
  assert.deepEqual(state.path, ['tempering', 'second-wind', 'steady-hand', 'deep-breath']);
  assert.deepEqual(respec(state, { inCombat: false }), { ok: true, refunded: 4 });
  assert.deepEqual(state.path, []);
  assert.equal(unspentPoints(state), 4);
  assert.equal(state.level, 5);
  assert.equal(state.xp, 840);
  assert.equal(progressionStats(state).maxHp, 132);
  assert.deepEqual(respec(state), { ok: true, refunded: 0 });
});

test('a new run starts at level 1 with an empty path', () => {
  const fresh = createProgression();
  assert.deepEqual(fresh, { xp: 0, level: 1, path: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), fresh);
  assert.notEqual(createProgression().path, fresh.path);
  const state = atLevel(6);
  spendPoint(state, 'tempering');
  assert.equal(resetProgression(state), state);
  assert.deepEqual(state, createProgression());
  assert.equal(progressionStats(state).maxHp, 100);
});

test('monster level scales health, damage and experience per §6.1', () => {
  assert.deepEqual(monsterLevelMultipliers(1), { hp: 1, damage: 1, xp: 1 });
  const courtyard = monsterLevelMultipliers(monsterLevelForZone('courtyard'));
  close(courtyard.hp, 1.18);
  close(courtyard.damage, 1.08);
  close(courtyard.xp, 1.25);
  assert.equal(monsterLevelForZone('road'), 1);
  assert.equal(monsterLevelForZone('camp'), 1);
  assert.equal(monsterLevelForZone('nowhere'), 1);
  // §6.3 health table and §6.4 incoming damage table.
  for (const [ml, hound, wraith, beetle] of [[1, 64, 76, 160], [2, 76, 90, 189], [9, 156, 185, 390]]) {
    assert.deepEqual([64, 76, 160].map(hp => scaleMonsterHp(hp, ml)), [hound, wraith, beetle], `hp at ML ${ml}`);
  }
  for (const [ml, leap, shot, slam] of [[1, 16, 12, 22], [2, 17, 13, 24], [9, 26, 20, 36]]) {
    assert.deepEqual([16, 12, 22].map(d => scaleMonsterDamage(d, ml)), [leap, shot, slam], `damage at ML ${ml}`);
  }
});
