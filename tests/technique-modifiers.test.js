import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, startAttack, startDash, updateGame, useSlot } from '../src/game.js';
import { assignSkill, chooseSkillModifier, gainXp } from '../src/run-progress.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
const events = (game, type) => game.events.filter(event => event.type === type);
const damage = (game, source) => events(game, 'damage')
  .filter(event => event.enemy && event.source === source).map(event => event.amount);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function advance(game, seconds, input = idle) {
  for (let tick = 0; tick < Math.round(seconds / .01); tick++) updateGame(game, input, .01);
}

// Real run/progression/loadout APIs, with a fixed, empty floor to isolate combat from packs,
// scenery and safe-area rules. Targets use the real adventure bodies, held in recovery.
// Expectations below are hand-calculated from §2.3–2.6 and +4% damage per level.
function arena(skill, modifier, { spirit = 100 } = {}) {
  const game = createAdventure({}, { seed: 501 });
  const templates = Object.fromEntries(['hound', 'wraith', 'beetle', 'ritual']
    .map(kind => [kind, game.enemies.find(enemy => enemy.kind === kind)]));
  const tiles = [];
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  game.enemies = [];
  Object.assign(game.player, { x: 0, y: 0, dx: 1, dy: 0, spirit });
  const [xp, level] = { dash: [220, 3], wave: [220, 3], palm: [450, 4], crane: [1510, 6], deflect: [1510, 6] }[skill];
  gainXp(game, xp);
  assert.equal(game.progression.level, level);
  const slot = { dash: 'space', wave: 'rmb', palm: 'q', crane: 'f', deflect: 'q' }[skill];
  if (skill !== 'dash') assert.equal(assignSkill(game, slot, skill).ok, true);
  assert.equal(chooseSkillModifier(game, skill, modifier).ok, true);
  assert.equal(game.loadout.modifiers[skill], modifier);
  // A modifier change really restarts cooldown (§2.8); never bypass it by zeroing timers.
  const recharge = { doubleStep: 3.2, crushingStep: 2.2, spiritStep: 1.2, mountainFall: 6 }[modifier]
    ?? { wave: 1.2, palm: .5, crane: 4, deflect: 3 }[skill];
  if (skill === 'dash') assert.equal(startDash(game, 1, 0), false);
  else assert.deepEqual(useSlot(game, slot), { ok: false, skill, reason: 'cooldown' });
  advance(game, recharge);
  game.events.length = 0;
  const enemy = (x, y, { kind = 'hound', hp = 1000, ...extra } = {}) => {
    const body = { ...templates[kind], id: `target-${game.enemies.length}`, kind, x, y, homeX: x, homeY: y,
      hp, maxHp: hp, level: 1, packId: null, wander: false, active: true, returning: false,
      state: 'recover', timer: 100, path: [], attackCooldown: 100, dx: -1, dy: 0,
      ...(kind === 'ritual' ? { sealed: false, state: 'idle' } : {}), ...extra };
    game.enemies.push(body);
    return body;
  };
  const cast = (x = 1, y = 0) => {
    if (skill === 'dash') assert.equal(startDash(game, x, y), true);
    else assert.deepEqual(useSlot(game, slot, x, y), { ok: true, skill });
  };
  return { game, enemy, cast, slot };
}

test('doubleStep: two 26-damage dashes, no spirit cost, and one charge every 1.6 seconds', () => {
  const { game, enemy, cast } = arena('dash', 'doubleStep', { spirit: 0 });
  const target = enemy(1.5, 0, { kind: 'beetle' });
  cast();
  close(game.player.dashCooldown, 1.6);
  advance(game, .2);
  assert.equal(target.hp, 974);
  assert.equal(target.exposed, true);
  assert.equal(events(game, 'guard-break').length, 1);
  cast(-1, 0);
  close(game.player.dashCooldown, 3);
  advance(game, .2);
  assert.deepEqual(damage(game, 'dash'), [26, 26], 'one hit per target per dash');
  assert.equal(startDash(game, 1, 0), false, 'both charges have been spent');
  advance(game, 1.19);
  assert.equal(startDash(game, 1, 0), false, 'a charge is not ready early');
  advance(game, .01);
  cast();
  close(game.player.dashCooldown, 3.2);
  assert.equal(game.player.spirit, 0);
});

test('crushingStep: 65 damage, 0.6 knockback, shell break, zero cost and 2.2-second recharge', () => {
  const { game, enemy, cast } = arena('dash', 'crushingStep', { spirit: 0 });
  const target = enemy(1.5, 0, { kind: 'beetle' });
  cast();
  close(game.player.dashCooldown, 2.2);
  advance(game, .2);
  assert.deepEqual(damage(game, 'dash'), [65]);
  assert.equal(target.hp, 935);
  close(target.x, 2.1);
  assert.equal(target.exposed, true);
  assert.equal(events(game, 'guard-break').length, 1);
  assert.equal(game.player.spirit, 0);
  advance(game, 1.99);
  assert.equal(startDash(game, 1, 0), false);
  advance(game, .01);
  cast();
});

for (const [count, gain] of [[0, 0], [1, 6], [2, 12], [4, 18]]) {
  test(`spiritStep: ${count} monsters grant ${gain} spirit, once each, capped at 18`, () => {
    const { game, enemy, cast } = arena('dash', 'spiritStep', { spirit: 10 });
    for (let i = 0; i < count; i++) enemy(.65 + i * .65, 0);
    const source = enemy(1.5, 0, { kind: 'ritual' });
    const dead = enemy(2, 0, { hp: 0 });
    cast();
    close(game.player.dashCooldown, 1.2);
    advance(game, .2);
    assert.equal(game.player.spirit, 10 + gain, 'the ritual and dead monsters grant no spirit');
    assert.equal(source.hp, 965, 'the ritual still takes the 35-damage dash');
    assert.equal(dead.hp, 0);
    assert.deepEqual(damage(game, 'dash'), Array(count + 1).fill(35));
    close(game.player.dashCooldown, 1);
  });
}

test('spiritStep: spirit cannot exceed the level-3 maximum of 110', () => {
  const { game, enemy, cast } = arena('dash', 'spiritStep', { spirit: 108 });
  enemy(1, 0, { kind: 'beetle' });
  cast(); advance(game, .2);
  assert.equal(game.player.spirit, 110);
  assert.equal(events(game, 'guard-break').length, 1);
});

test('heavyWave: 119 damage within 2.6, 1.4 knockback, 40 spirit and 1.2-second cooldown', () => {
  const { game, enemy, cast, slot } = arena('wave', 'heavyWave');
  const edge = enemy(2.6, 0, { kind: 'beetle' });
  const outside = enemy(0, -2.61);
  cast();
  assert.equal(edge.hp, 881);
  close(edge.x, 4);
  assert.equal(edge.exposed, true);
  assert.equal(outside.hp, 1000);
  assert.equal(game.player.spirit, 60);
  close(game.player.waveCooldown, 1.2);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, 1.19);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .01);
  cast();
  assert.equal(game.player.spirit, 20);
});

test('vortexWave: pulls from 4.4 to 0.9 before 52 damage and knockback, retaining shell break', () => {
  const { game, enemy, cast } = arena('wave', 'vortexWave');
  const pulled = enemy(4.4, 0, { kind: 'beetle' });
  const outside = enemy(0, -4.41);
  const source = enemy(0, 4, { kind: 'ritual' });
  cast();
  assert.equal(pulled.hp, 948, 'a monster outside the normal 3.4 radius is pulled into the hit');
  close(pulled.x, 1.8, '0.9 pull destination plus 0.9 wave knockback');
  assert.equal(pulled.exposed, true);
  assert.equal(events(game, 'guard-break').length, 1);
  assert.deepEqual([outside.hp, outside.y, source.hp, source.y], [1000, -4.41, 1000, 4]);
  assert.equal(game.player.spirit, 60);
  close(game.player.waveCooldown, 1.2);
  advance(game, .01);
  assert.deepEqual(damage(game, 'wave'), [52]);
});

test('vortexWave: a wall prevents both pull and damage', () => {
  const { game, enemy, cast } = arena('wave', 'vortexWave');
  const target = enemy(4, 0);
  game.world.obstacles.push({ x: 2, y: 0, halfWidth: .2, halfDepth: 2 });
  cast(); advance(game, .01);
  assert.deepEqual([target.x, target.hp], [4, 1000]);
});

for (const [count, heal] of [[0, 0], [1, 4], [4, 16], [6, 20]]) {
  test(`calmWave: ${count} monsters heal ${heal}, with 65 damage and the 20-health cap`, () => {
    const { game, enemy, cast } = arena('wave', 'calmWave');
    game.player.hp = 50;
    for (let i = 0; i < count; i++) enemy(1 + i * .3, 0, { kind: i === 0 ? 'beetle' : 'hound' });
    const source = enemy(0, 2, { kind: 'ritual' });
    cast(); advance(game, .01);
    assert.equal(game.player.hp, 50 + heal, 'the ritual takes damage but grants no healing');
    assert.equal(source.hp, 935);
    assert.deepEqual(damage(game, 'wave'), Array(count + 1).fill(65));
    assert.equal(game.player.spirit, 60);
    close(game.player.waveCooldown, 1.19);
    assert.equal(events(game, 'guard-break').length, count ? 1 : 0);
    assert.deepEqual(events(game, 'wave-heal').map(event => event.amount), count ? [heal] : []);
  });
}

test('calmWave: healing stops at maxHp', () => {
  const { game, enemy, cast } = arena('wave', 'calmWave');
  game.player.hp = 115;
  enemy(2, 0); cast(); advance(game, .01);
  assert.equal(game.player.hp, 116);
  assert.equal(events(game, 'wave-heal')[0].amount, 1);
});

test('piercingPalm: one palm hits three monsters once for 36 each and expires at range 7', () => {
  const { game, enemy, cast, slot } = arena('palm', 'piercingPalm');
  const targets = [enemy(1, 0), enemy(3, 0), enemy(5, 0)];
  const outside = enemy(7.8, 0);
  cast();
  assert.equal(game.player.spirit, 80);
  close(game.player.cooldowns.palm, .5);
  assert.equal(game.monkShots.length, 1);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .4);
  assert.deepEqual(targets.map(target => target.hp), [964, 964, 964]);
  assert.deepEqual(damage(game, 'palm'), [36, 36, 36]);
  assert.equal(game.monkShots.length, 1, 'piercing keeps the projectile alive after three hits');
  advance(game, .2);
  assert.equal(game.monkShots.length, 0);
  assert.equal(outside.hp, 1000);
  cast();
});

for (const [label, facing, hp, behindHp] of [['front', -1, 991, 1000], ['back', 1, 964, 964], ['side', 0, 964, 964]]) {
  test(`piercingPalm: a shell ${label} takes ${1000 - hp}, with no break and ${label === 'front' ? 'stops' : 'passes'} the palm`, () => {
    const { game, enemy, cast } = arena('palm', 'piercingPalm');
    const shell = enemy(2, 0, { kind: 'beetle', dx: facing, dy: facing ? 0 : 1 });
    const behind = enemy(4, 0);
    cast(); advance(game, .5);
    assert.deepEqual([shell.hp, behind.hp], [hp, behindHp]);
    assert.equal(shell.exposed, false);
    assert.equal(events(game, 'guard-break').length, 0);
    assert.equal(events(game, 'block').length, label === 'front' ? 1 : 0);
  });
}

test('explodingPalm: a marked death bursts for 45 damage inside radius 2, once', () => {
  const { game, enemy, cast } = arena('palm', 'explodingPalm');
  const marked = enemy(2, 0, { kind: 'beetle', dx: 1, hp: 90 });
  // Each palm pushes the dying target 0.3: the burst centre will be (2.6, 0).
  const edge = enemy(2.6, 2), outside = enemy(2.6, -2.01);
  cast(); advance(game, .2);
  assert.equal(marked.hp, 45);
  close(marked.x, 2.3);
  assert.ok(marked.mark && marked.mark.t > 2.8);
  close(game.player.cooldowns.palm, .3);
  assert.equal(game.player.spirit, 80);
  advance(game, .3);
  cast(); advance(game, .2);
  assert.equal(marked.hp, 0);
  assert.equal(edge.hp, 955);
  assert.equal(outside.hp, 1000);
  assert.deepEqual(damage(game, 'palm'), [45, 45, 45]);
  assert.equal(events(game, 'palm-burst').length, 1);
  close(events(game, 'palm-burst')[0].x, 2.6);
  assert.equal(game.player.spirit, 60);
  advance(game, .2);
  assert.equal(events(game, 'palm-burst').length, 1);
});

for (const [delay, bursts] of [[2.7, 1], [3.1, 0]]) {
  test(`explodingPalm: a death ${delay}s after the mark ${bursts ? 'bursts before' : 'does not burst after'} its 3s expiry`, () => {
    const { game, enemy, cast } = arena('palm', 'explodingPalm');
    const marked = enemy(2, 0, { kind: 'beetle', dx: 1, hp: 70 });
    cast(); advance(game, .2);
    assert.equal(marked.hp, 25);
    advance(game, delay);
    Object.assign(game.player, { x: marked.x - 1, y: marked.y });
    assert.equal(startAttack(game, 1, 0), true);
    advance(game, .1);
    assert.equal(marked.hp, 0);
    assert.equal(events(game, 'palm-burst').length, bursts);
  });
}

test('palmFan: three separate hits of 27 in a ±14-degree fan, costing 26 spirit', () => {
  const { game, enemy, cast, slot } = arena('palm', 'palmFan');
  const targets = [enemy(4, -.9973120113727227), enemy(4, 0), enemy(4, .9973120113727227)];
  const outside = enemy(4, 2);
  cast();
  assert.equal(game.player.spirit, 74);
  close(game.player.cooldowns.palm, .5);
  assert.equal(game.monkShots.length, 3);
  for (const [index, dy] of [-.24192189559966773, 0, .24192189559966773].entries()) {
    close(game.monkShots[index].dy, dy);
    close(game.monkShots[index].dx, index === 1 ? 1 : .9702957262759965);
  }
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .4);
  assert.deepEqual(targets.map(target => target.hp), [973, 973, 973]);
  assert.equal(outside.hp, 1000);
  assert.deepEqual(damage(game, 'palm'), [27, 27, 27]);
  assert.equal(game.monkShots.length, 0);
});

for (const [modifier, hit] of [['explodingPalm', 11], ['palmFan', 7]]) {
  test(`${modifier}: a frontal shell blocks and stops the palm without a mark or shell break`, () => {
    const { game, enemy, cast } = arena('palm', modifier);
    const shell = enemy(3, 0, { kind: 'beetle' });
    const behind = enemy(5, 0);
    cast(); advance(game, .6);
    assert.equal(shell.hp, 1000 - hit);
    assert.equal(behind.hp, 1000);
    assert.equal(shell.mark ?? null, null);
    assert.equal(shell.exposed, false);
    assert.equal(events(game, 'guard-break').length, 0);
  });
}

test('mountainFall: 96 damage in radius 2.4, 0.5 knockback, 30 spirit and 6-second cooldown', () => {
  const { game, enemy, cast, slot } = arena('crane', 'mountainFall');
  const edge = enemy(3, 2.4), outside = enemy(3, -2.41);
  cast(3, 0);
  assert.equal(game.player.spirit, 70);
  close(game.player.cooldowns.crane, 6);
  advance(game, .39);
  assert.equal(edge.hp, 1000, 'damage waits for the 0.4s flight to finish');
  advance(game, .01);
  close(game.player.x, 3);
  assert.equal(game.player.technique, null);
  assert.deepEqual([edge.hp, outside.hp], [904, 1000]);
  close(edge.y, 2.9);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, 5.59);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .01);
  cast(1.5, 0);
});

test('lightCrane: 12 spirit buys a 6.5-unit flight and 36 damage in the ordinary 1.6 radius', () => {
  const { game, enemy, cast, slot } = arena('crane', 'lightCrane', { spirit: 24 });
  const target = enemy(7.5, 0), outside = enemy(6.5, 1.61);
  cast(9, 0);
  assert.equal(game.player.spirit, 12);
  close(game.player.cooldowns.crane, 4);
  advance(game, .4);
  close(game.player.x, 6.5);
  assert.deepEqual([target.hp, outside.hp], [964, 1000]);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, 3.6);
  cast(-.1, 0); advance(game, .4);
  close(game.player.x, 5, 'the minimum jump remains 1.5 units');
  assert.equal(game.player.spirit, 0);
});

test('lightCrane: walls still stop the extended jump', () => {
  const { game, cast } = arena('crane', 'lightCrane');
  game.world.obstacles.push({ x: 4, y: 0, halfWidth: .2, halfDepth: 2 });
  cast(9, 0); advance(game, .4);
  assert.ok(game.player.x > 3.4 && game.player.x <= 3.57, `landed at ${game.player.x}`);
});

test('shatteringLanding: 53 full damage breaks a frontal shell, costs 30, cooldown remains 4s', () => {
  const { game, enemy, cast } = arena('crane', 'shatteringLanding');
  const shell = enemy(4, 0, { kind: 'beetle' }), outside = enemy(3, 1.61);
  cast(3, 0);
  assert.equal(game.player.spirit, 70);
  close(game.player.cooldowns.crane, 4);
  advance(game, .4);
  assert.equal(shell.hp, 947);
  close(shell.x, 4.5);
  assert.equal(shell.exposed, true);
  assert.equal(shell.state, 'stunned');
  assert.equal(outside.hp, 1000);
  assert.deepEqual(events(game, 'guard-break').map(event => [event.id, event.source]), [[shell.id, 'crane']]);
});

test('shatteringLanding: break immunity preserves the front block (13 damage)', () => {
  const { game, enemy, cast } = arena('crane', 'shatteringLanding');
  const shell = enemy(4, 0, { kind: 'beetle', breakImmunity: 10 });
  cast(3, 0); advance(game, .4);
  assert.equal(shell.hp, 987);
  assert.equal(shell.exposed, false);
  assert.equal(events(game, 'guard-break').length, 0);
});

for (const [modifier, frontHit, fullHit] of [['mountainFall', 24, 96], ['lightCrane', 9, 36]]) {
  for (const [side, facing, hit] of [['front', -1, frontHit], ['back', 1, fullHit]]) {
    test(`${modifier}: shell ${side} is judged from the landing point without breaking it`, () => {
      const { game, enemy, cast } = arena('crane', modifier);
      const shell = enemy(4, 0, { kind: 'beetle', dx: facing });
      cast(3, 0); advance(game, .4);
      assert.equal(shell.hp, 1000 - hit);
      assert.equal(shell.exposed, false);
      assert.equal(events(game, 'guard-break').length, 0);
    });
  }
}

test('spiritRiposte: zero-cost success grants 35 spirit once, deals 72 and resets the dash', () => {
  const { game, enemy, cast, slot } = arena('deflect', 'spiritRiposte', { spirit: 0 });
  assert.equal(startDash(game, 1, 0), true);
  assert.ok(game.player.dashCooldown > 0);
  cast();
  assert.equal(game.player.dashTime, 0, 'the stance can interrupt an active dash');
  assert.equal(game.player.spirit, 0);
  const attacker = enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  const bystander = enemy(0, 1);
  advance(game, .01);
  assert.equal(attacker.hp, 928);
  assert.equal(attacker.timer, .6);
  assert.equal(bystander.hp, 1000, 'the ordinary riposte answers only the attacker');
  assert.equal(game.player.hp, 140);
  assert.equal(game.player.spirit, 35);
  assert.equal(game.player.dashCooldown, 0);
  enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  advance(game, .01);
  assert.equal(game.player.spirit, 35, 'a second success in the same stance grants no more spirit');
  assert.equal(events(game, 'deflect-success').length, 2);
  assert.equal(game.player.cooldowns.deflect, 0);
  advance(game, .38);
  assert.equal(game.player.technique, null);
  close(game.player.cooldowns.deflect, 3);
  assert.equal(game.player.lockout, 0);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .01);
  assert.equal(startDash(game, 0, -1), true, 'the reset permits another dash');
});

test('spiritRiposte: spirit gain is clamped to the level-6 maximum of 125', () => {
  const { game, enemy, cast } = arena('deflect', 'spiritRiposte', { spirit: 120 });
  cast();
  enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  advance(game, .01);
  assert.equal(game.player.spirit, 125);
});

test('wideStance: an attack after 0.5s is parried for 43 damage; the window lasts 0.65s', () => {
  const { game, enemy, cast, slot } = arena('deflect', 'wideStance', { spirit: 0 });
  cast();
  advance(game, .5, { ...idle, moveX: 1 });
  close(game.player.x, 0, 'the stance roots the monk');
  assert.equal(game.player.technique.id, 'deflect');
  assert.equal(game.player.cooldowns.deflect, 0);
  const attacker = enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  advance(game, .01);
  assert.equal(attacker.hp, 957);
  assert.equal(attacker.timer, .6);
  assert.equal(game.player.hp, 140);
  assert.equal(game.player.spirit, 20);
  advance(game, .13);
  assert.equal(game.player.technique.id, 'deflect');
  advance(game, .01);
  assert.equal(game.player.technique, null);
  close(game.player.cooldowns.deflect, 3);
  assert.equal(game.player.lockout, 0);
  advance(game, 2.99);
  assert.equal(useSlot(game, slot).reason, 'cooldown');
  advance(game, .01);
  cast();
});

test('wideStance: a whiff ends at 0.65s, costs no spirit and locks attacks/dash for 0.35s', () => {
  const { game, cast } = arena('deflect', 'wideStance', { spirit: 0 });
  cast(); advance(game, .64);
  assert.equal(game.player.technique.id, 'deflect');
  advance(game, .01);
  close(game.player.lockout, .35);
  close(game.player.cooldowns.deflect, 3);
  assert.equal(game.player.spirit, 0);
  assert.equal(startAttack(game, 1, 0), false);
  assert.equal(startDash(game, 1, 0), false);
  advance(game, .34);
  assert.equal(startDash(game, 1, 0), false);
  advance(game, .01);
  assert.equal(startDash(game, 1, 0), true);
});

test('circularRiposte: hits all monsters within 1.8 for 54, with one spirit reward', () => {
  const { game, enemy, cast } = arena('deflect', 'circularRiposte', { spirit: 0 });
  const attacker = enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  const edge = enemy(0, 1.8), outside = enemy(0, -1.81);
  const shell = enemy(-1, 0, { kind: 'beetle', dx: 1 });
  const source = enemy(1, 1, { kind: 'ritual' });
  cast(); advance(game, .01);
  assert.deepEqual([attacker.hp, edge.hp, outside.hp, shell.hp, source.hp], [946, 946, 1000, 986, 1000]);
  assert.equal(attacker.state, 'stunned');
  assert.equal(edge.state, 'stunned');
  close(edge.timer, .59);
  assert.equal(shell.exposed, false, 'a nearby shell is not the deflected slam attacker');
  assert.equal(events(game, 'guard-break').length, 0);
  assert.equal(game.player.hp, 140);
  assert.equal(game.player.spirit, 20);
  assert.equal(game.player.cooldowns.deflect, 0);
  advance(game, .39);
  close(game.player.cooldowns.deflect, 3);
});

test('circularRiposte: walls exclude nearby monsters from the counterattack', () => {
  const { game, enemy, cast } = arena('deflect', 'circularRiposte');
  const attacker = enemy(.5, 0, { state: 'leap', timer: .27, dx: -1, hit: false });
  const hidden = enemy(-1.5, 0);
  game.world.obstacles.push({ x: -.8, y: 0, halfWidth: .1, halfDepth: 2 });
  cast(); advance(game, .01);
  assert.equal(attacker.hp, 946);
  assert.equal(hidden.hp, 1000);
});

for (const [modifier, hit, spirit] of [['spiritRiposte', 72, 35], ['wideStance', 43, 20], ['circularRiposte', 54, 20]]) {
  test(`${modifier}: a deflected beetle slam breaks its shell with ${hit} full damage`, () => {
    const { game, enemy, cast } = arena('deflect', modifier, { spirit: 0 });
    const shell = enemy(1, 0, { kind: 'beetle', state: 'slam', timer: .15, hit: false });
    cast(); advance(game, .01);
    assert.equal(shell.hp, 1000 - hit);
    assert.equal(shell.exposed, true);
    assert.equal(shell.state, 'stunned');
    assert.equal(game.player.hp, 140);
    assert.equal(game.player.spirit, spirit);
    assert.deepEqual(events(game, 'guard-break').map(event => [event.id, event.source]), [[shell.id, 'deflect']]);
  });

  test(`${modifier}: reflects a real wraith shot for 48 damage and ${spirit} spirit`, () => {
    const { game, enemy, cast } = arena('deflect', modifier, { spirit: 0 });
    const wraith = enemy(2, 0, { kind: 'wraith', state: 'windup', timer: .01, dx: -1 });
    cast(); advance(game, .64);
    assert.equal(game.player.hp, 140);
    assert.equal(game.player.spirit, spirit);
    assert.equal(wraith.hp, 952);
    assert.deepEqual(damage(game, 'deflect'), [48]);
    assert.equal(events(game, 'shot').length, 1);
    assert.equal(game.projectiles.length, 0);
    assert.equal(game.monkShots.length, 0);
  });
}
