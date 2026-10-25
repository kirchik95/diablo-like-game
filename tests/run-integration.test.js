import { levelForXp } from '../src/progression.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, createAdventure, updateGame, startAttack, startDash, startWave, interact, getInteractionPrompt, useSlot,
} from '../src/game.js';
import { BEETLE_STATS, CAMP_SUPPLIES, WRAITH_STATS } from '../src/campaign.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { ITEM_RULES, createItem, lootForSite, pickUpItem, rollRunLoot } from '../src/items.js';
import { createLoadout } from '../src/skills.js';
import { gainXp, assignSkill, chooseSkillModifier, slotStates } from '../src/run-progress.js';
import { equipItem, unequipItem, dropItem } from '../src/inventory-actions.js';
import { isWalkable } from '../src/world.js';
import { Input } from '../src/input.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const ofType = (game, type) => game.events.filter(event => event.type === type);
function arena() {
  const game = createGame(), template = game.enemies[0], tiles = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  game.projectiles = []; game._nextProjectileId = 0;
  Object.assign(game.player, { x: 0, y: 0 });
  game.enemies = [];
  const enemy = (x, y, hp = 500, extra = {}) => {
    const e = { ...template, id: `e${game.enemies.length}`, x, y, homeX: x, homeY: y,
      hp, maxHp: hp, state: 'stunned', timer: 100, path: [], ...extra };
    game.enemies.push(e); return e;
  };
  // A recovering shell holds still and keeps its facing.
  const beetle = (x, y, extra = {}) => enemy(x, y, 500, { kind: 'beetle', radius: BEETLE_STATS.radius, exposed: false,
    breakImmunity: 0, dx: 0, dy: -1, state: 'recover', timer: 100, ...extra });
  return { game, enemy, beetle };
}
function advance(game, duration, input = idle, dt = .01) {
  for (let i = 0; i < Math.round(duration / dt); i++) updateGame(game, input, dt);
}
const weapon = (family, extra = {}) => createItem({ id: `test-${family}`, family, ...extra });
function equip(game, item) {
  const { slot } = pickUpItem(game.inventory, item);
  assert.equal(equipItem(game, slot).ok, true);
}
// One full strike of the current series at the aim; returns the damage events it dealt.
// A target given back at its place keeps every strike of a series in reach despite knockback.
function strike(game, dx = 1, dy = 0, target = null) {
  if (target) Object.assign(target, { x: target.homeX, y: target.homeY, state: 'stunned', timer: 100 });
  const start = game.events.length;
  assert.equal(startAttack(game, dx, dy), true);
  const { index } = game.player.attack;
  for (let i = 0; i < 200 && game.player.attack; i++) updateGame(game, { ...idle, aimX: dx, aimY: dy }, .01);
  return { index, damage: game.events.slice(start).filter(e => e.type === 'damage' && e.enemy).map(e => e.amount) };
}
// Kills a monster with a real wave from its own position.
function waveKill(game, e) {
  e.hp = 1;
  Object.assign(game.player, { x: e.x, y: e.y, spirit: 100, waveCooldown: 0, attack: null, invulnerable: 100 });
  assert.equal(startWave(game), true);
  assert.equal(e.hp, 0);
}

test('kills grant experience; level 2 raises health and spirit and slots the palm in Q', () => {
  const { game, enemy } = arena();
  for (let i = 0; i < 8; i++) enemy(1.2, (i - 3.5) * .3, 24);
  game.player.hp = 50;
  assert.equal(startWave(game), true);
  assert.deepEqual(ofType(game, 'xp').map(e => e.amount), [10, 10, 10, 10, 10, 10, 10, 10]);
  assert.deepEqual([game.progression.xp, game.progression.level], [80, 2]);
  const [levelUp] = ofType(game, 'level-up');
  assert.deepEqual([levelUp.level, levelUp.hp, levelUp.spirit, levelUp.points], [2, 8, 5, 1]);
  assert.deepEqual(levelUp.unlocks, { techniques: ['palm'], slots: ['q'], modifiers: [] });
  assert.deepEqual([game.player.hp, game.player.maxHp, game.player.maxSpirit], [58, 108, 105]);
  assert.deepEqual(ofType(game, 'technique-learned').map(e => [e.technique, e.slot]), [['palm', 'q']]);
  assert.equal(game.loadout.slots.q, 'palm');
});

test('levels 4 and 5 put the crane in F and leave the deflect unslotted', () => {
  const { game } = arena();
  gainXp(game, 450);
  assert.equal(game.progression.level, 4);
  assert.deepEqual([game.player.maxHp, game.player.hp, game.player.maxSpirit], [124, 124, 115]);
  assert.deepEqual(game.loadout.slots, { lmb: 'combo', space: 'dash', rmb: 'wave', q: 'palm', f: 'crane' });
  gainXp(game, 390);
  assert.equal(game.progression.level, 5);
  assert.deepEqual(ofType(game, 'technique-learned').map(e => [e.technique, e.slot]),
    [['palm', 'q'], ['crane', 'f'], ['deflect', null]]);
  assert.equal(Object.values(game.loadout.slots).includes('deflect'), false);
});

test('Q unlocks at level 2 and F at level 4; locked or empty slots cast nothing', () => {
  const { game } = arena();
  assert.deepEqual(useSlot(game, 'q', 1, 0), { ok: false, skill: null, reason: 'locked' });
  assert.deepEqual(useSlot(game, 'f', 1, 0), { ok: false, skill: null, reason: 'locked' });
  gainXp(game, 80);
  assert.equal(useSlot(game, 'f', 1, 0).reason, 'locked');
  assert.deepEqual(useSlot(game, 'q', 1, 0), { ok: true, skill: 'palm' });
  gainXp(game, 370);
  game.player.spirit = 100;
  assert.deepEqual(useSlot(game, 'f', 1, 0), { ok: true, skill: 'crane' });
  assert.deepEqual(slotStates(game).map(s => [s.slot, s.skill, s.locked]),
    [['lmb', 'combo', false], ['space', 'dash', false], ['rmb', 'wave', false], ['q', 'palm', false], ['f', 'crane', false]]);
});

test('RMB keeps the wave by default and casts it through the loadout', () => {
  const { game, enemy } = arena(), target = enemy(2, 0);
  assert.equal(createLoadout().slots.rmb, 'wave');
  assert.deepEqual(useSlot(game, 'rmb', 1, 0), { ok: true, skill: 'wave' });
  assert.equal(target.hp, 500 - 72); assert.equal(game.player.spirit, 20);
  assert.deepEqual(useSlot(game, 'rmb', 1, 0), { ok: false, skill: 'wave', reason: 'spirit' });
  game.player.spirit = 100;
  assert.deepEqual(useSlot(game, 'rmb', 1, 0), { ok: false, skill: 'wave', reason: 'cooldown' });
});

test('palm: 20 spirit, 0.5 s cooldown, 40 × level damage to the first monster in its line', () => {
  const { game, enemy } = arena(), near = enemy(3, 0), far = enemy(5, 0);
  gainXp(game, 80);
  assert.equal(useSlot(game, 'q', 1, 0).ok, true);
  assert.equal(game.player.spirit, 40); close(game.player.cooldowns.palm, .5);
  assert.equal(game.monkShots.length, 1);
  assert.deepEqual(useSlot(game, 'q', 1, 0), { ok: false, skill: 'palm', reason: 'cooldown' });
  advance(game, .3);
  assert.equal(near.hp, 500 - Math.round(40 * 1.04)); assert.equal(far.hp, 500);
  assert.equal(game.monkShots.length, 0);
  advance(game, .2);
  assert.equal(useSlot(game, 'q', 1, 0).ok, true);
});

test('palm: a shell front blocks it at 25% and stops it; the shell back takes it in full', () => {
  const palm = Math.round(40 * 1.04);
  for (const [label, facing, expected] of [['front', -1, Math.round(palm * BEETLE_STATS.blockDamage)], ['back', 1, palm]]) {
    const { game, beetle } = arena(), shell = beetle(3, 0, { dx: facing, dy: 0 }), behind = beetle(4.5, 0, { dx: 1, dy: 0 });
    gainXp(game, 80);
    assert.equal(useSlot(game, 'q', 1, 0).ok, true, label);
    advance(game, .6);
    assert.equal(shell.hp, 500 - expected, label);
    assert.equal(behind.hp, 500, `${label}: a palm stops at its first monster`);
  }
});

test('crane: 30 spirit, 4 s cooldown, invulnerable flight, landing hits 56 × level in 1.6u', () => {
  const { game, enemy } = arena(), landing = enemy(4.3, 0), outside = enemy(6.2, 0);
  gainXp(game, 450);
  game.player.spirit = 100;
  const hound = enemy(0, .5, 500, { kind: 'hound', state: 'leap', timer: .27, dx: 0, dy: -1, hit: false });
  assert.equal(useSlot(game, 'f', 3.5, 0).ok, true);
  assert.equal(game.player.spirit, 70); close(game.player.cooldowns.crane, 4);
  assert.equal(game.player.technique.id, 'crane');
  assert.equal(startAttack(game, 1, 0), false); assert.equal(startDash(game, 1, 0), false);
  advance(game, .2);
  assert.equal(game.player.hp, 124, 'the flight passes over a leap');
  assert.ok(hound.hit);
  advance(game, .2);
  assert.equal(game.player.technique, null);
  close(game.player.x, 3.5);
  assert.equal(landing.hp, 500 - Math.round(56 * 1.12)); assert.equal(outside.hp, 500);
  assert.ok(ofType(game, 'crane-land').length === 1);
  assert.deepEqual(useSlot(game, 'f', 3, 0), { ok: false, skill: 'crane', reason: 'cooldown' });
});

test('crane: a wall cuts the jump short and the minimum range is 1.5u', () => {
  const { game } = arena();
  game.world.obstacles.push({ x: 2.5, y: 0, halfWidth: .2, halfDepth: 3 });
  gainXp(game, 450); game.player.spirit = 100;
  assert.equal(useSlot(game, 'f', 5, 0).ok, true);
  advance(game, .4);
  assert.ok(game.player.x < 2.3 - game.player.radius + 1e-9 && game.player.x > 1.5, `landed at ${game.player.x}`);
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
  const short = arena().game;
  gainXp(short, 450); short.player.spirit = 100;
  useSlot(short, 'f', .2, 0); advance(short, .4);
  close(short.player.x, 1.5);
});

test('deflect: 0 spirit, a riposte of 60 × level with a stun, +20 spirit, 3 s cooldown after the window', () => {
  const { game, enemy } = arena();
  gainXp(game, 840);
  assert.equal(assignSkill(game, 'rmb', 'deflect').ok, true);
  assert.equal(game.player.cooldowns.deflect, 0, 'a newly learned technique enters its first slot ready (§2.9.8)');
  game.player.spirit = 50;
  const hound = enemy(.5, 0, 500, { kind: 'hound', state: 'leap', timer: .27, dx: -1, dy: 0, hit: false });
  assert.deepEqual(useSlot(game, 'rmb'), { ok: true, skill: 'deflect' });
  assert.equal(game.player.spirit, 50);
  updateGame(game, idle, .01);
  assert.equal(game.player.hp, 132, 'a deflected hit deals no damage');
  assert.equal(hound.hp, 500 - Math.round(60 * 1.16));
  assert.deepEqual([hound.state, hound.timer], ['stunned', .6]);
  assert.equal(game.player.spirit, 70);
  assert.equal(game.player.cooldowns.deflect, 0, 'the cooldown waits for the window to close');
  advance(game, .4);
  assert.equal(game.player.technique, null);
  assert.ok(game.player.cooldowns.deflect > 2.98 && game.player.cooldowns.deflect <= 3, 'the cooldown starts after the window');
  assert.equal(game.player.lockout, 0, 'a successful stance has no lockout');
});

test('deflect: a whiffed stance locks strikes and the dash for 0.35 s; it can start during the dash', () => {
  const { game } = arena();
  gainXp(game, 840);
  assignSkill(game, 'q', 'deflect'); game.player.cooldowns.deflect = 0;
  assert.equal(startDash(game, 1, 0), true);
  assert.equal(useSlot(game, 'q').ok, true);
  assert.equal(game.player.dashTime, 0, 'the stance ends the dash');
  advance(game, .4);
  close(game.player.lockout, .35);
  assert.equal(ofType(game, 'deflect-whiff').length, 1);
  assert.equal(startAttack(game, 1, 0), false);
  game.player.dashCooldown = 0;
  assert.equal(startDash(game, 1, 0), false);
  advance(game, .35);
  assert.equal(startAttack(game, 1, 0), true);
});

test('deflect: a deflected beetle slam breaks the shell; a deflected shot flies back to the wraith', () => {
  const { game, beetle, enemy } = arena();
  gainXp(game, 840);
  assignSkill(game, 'q', 'deflect'); game.player.cooldowns.deflect = 0;
  const shell = beetle(0, 1, { state: 'windup', timer: .01, dx: 0, dy: -1 });
  assert.equal(useSlot(game, 'q').ok, true);
  advance(game, .05);
  assert.equal(game.player.hp, 132);
  assert.deepEqual([shell.state, shell.exposed], ['stunned', true]);
  assert.equal(shell.hp, 500 - Math.round(60 * 1.16), 'a breaking riposte deals full damage');
  assert.equal(ofType(game, 'guard-break').length, 1);

  const ranged = arena();
  gainXp(ranged.game, 840);
  assignSkill(ranged.game, 'q', 'deflect'); ranged.game.player.cooldowns.deflect = 0;
  const wraith = ranged.enemy(4, 0, 500, { kind: 'wraith' });
  ranged.game.projectiles.push({ id: 'shot-x', x: 1, y: 0, dx: -1, dy: 0, radius: .13, life: 2, owner: wraith.id, damage: 12 });
  assert.equal(useSlot(ranged.game, 'q').ok, true);
  advance(ranged.game, .9);
  assert.equal(ranged.game.player.hp, 132);
  assert.equal(ranged.game.projectiles.length, 0);
  assert.equal(wraith.hp, 500 - Math.round(40 * 1.16));
});

test('camp supplies (E) put both common weapons into the bag once', () => {
  const game = createAdventure();
  Object.assign(game.player, CAMP_SUPPLIES);
  assert.ok(isWalkable(CAMP_SUPPLIES.x, CAMP_SUPPLIES.y, game.player.radius, game.world));
  assert.equal(getInteractionPrompt(game), 'E — взять припасы');
  assert.equal(interact(game), true);
  assert.deepEqual(game.inventory.bag.filter(Boolean).map(item => [item.id, item.family, item.rarity, item.ilvl]),
    [['camp-knuckles', 'knuckles', 'common', 1], ['camp-staff', 'staff', 'common', 1]]);
  assert.equal(game.inventory.equipped.weapon, null, 'the monk still fights bare-handed');
  assert.equal(ofType(game, 'loot-pickup').length, 2); assert.equal(ofType(game, 'supplies').length, 1);
  assert.equal(getInteractionPrompt(game), ''); assert.equal(interact(game), false);
  Object.assign(game.player, game.world.reward);
  assert.equal(getInteractionPrompt(game), '', 'the reward point is outside the supplies reach');
});

test('loot is fixed by the run seed: a cleared pack drops its rolled item where its last monster fell', () => {
  const order = [['road-approach', 'road-crossing'], ['road-crossing', 'road-approach']];
  const results = order.map(packs => {
    const game = createAdventure({}, { seed: 777 });
    const drops = {};
    for (const packId of packs) {
      const members = game.enemies.filter(e => e.packId === packId);
      for (const e of members) if (e.hp > 0) waveKill(game, e);
      const ground = game.groundItems.find(g => g.source === packId);
      assert.ok(ground, packId);
      assert.ok(members.some(e => e.x === ground.x && e.y === ground.y), 'the drop lies where a pack monster fell');
      drops[packId] = ground.item;
      assert.equal(ofType(game, 'pack-cleared').filter(e => e.packId === packId).length, 1);
    }
    return { game, drops };
  });
  const loot = rollRunLoot(777);
  for (const packId of ['road-approach', 'road-crossing']) {
    assert.deepEqual(results[0].drops[packId], lootForSite(loot, packId)[0]);
    assert.deepEqual(results[1].drops[packId], results[0].drops[packId]);
  }
  assert.deepEqual(results[0].game.loot, createAdventure({}, { seed: 777 }).loot);
});

test('the cache relic matches the equipped family and the source drops its rare item', () => {
  const game = createAdventure({}, { seed: 99 });
  equip(game, weapon('knuckles'));
  Object.assign(game.player, game.world.secret);
  assert.equal(interact(game), true);
  const relic = game.groundItems.find(g => g.source === 'secret').item;
  assert.deepEqual([relic.family, relic.rarity, relic.relic], ['knuckles', 'relic', 'quiet-thunder']);
  updateGame(game, idle, .01);
  assert.ok(game.inventory.bag.some(item => item?.id === relic.id), 'standing on the cache picks the relic up');
  const source = game.enemies.find(e => e.kind === 'ritual');
  for (const e of game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual')) e.hp = 0;
  updateGame(game, idle, .01);
  waveKill(game, source);
  const drop = game.groundItems.find(g => g.source === 'court-ritual');
  assert.deepEqual([drop.item.rarity, drop.item.ilvl], ['rare', 3]);
  assert.ok(isWalkable(drop.x, drop.y, .1, game.world));
});

test('a cemetery or orchard pack drops its own loot site item; side wanderers drop none (world-expansion §6.3)', () => {
  const game = createAdventure({}, { seed: 777 }), loot = rollRunLoot(777);
  for (const packId of ['cemetery-graves', 'cemetery-obelisk', 'orchard-press', 'orchard-well']) {
    const members = game.enemies.filter(e => e.packId === packId);
    assert.ok(members.length, packId);
    for (const e of members) if (e.hp > 0) waveKill(game, e);
    const ground = game.groundItems.find(g => g.source === packId);
    assert.deepEqual(ground.item, lootForSite(loot, packId)[0]);
    assert.equal(ground.item.ilvl, packId.startsWith('cemetery') ? 2 : 3);
    assert.ok(members.some(e => e.x === ground.x && e.y === ground.y), 'the drop lies where a pack monster fell');
  }
  const wanderers = game.enemies.filter(e => e.wander && e.id.startsWith('side-'));
  assert.ok(wanderers.length);
  for (const e of wanderers) if (e.hp > 0) waveKill(game, e);
  assert.equal(game.groundItems.filter(g => g.source.startsWith('side-')).length, 0);
});

test('walking over an item bags it; a full bag leaves it with one notice until the monk steps away', () => {
  const game = createAdventure();
  Object.assign(game.player, { x: 0, y: -35 });
  for (let i = 0; i < ITEM_RULES.bagSize; i++) pickUpItem(game.inventory, createItem({ id: `filler-${i}`, family: 'staff' }));
  const item = createItem({ id: 'ground-test', family: 'knuckles' });
  game.groundItems.push({ id: item.id, item, x: 0, y: -35.4, source: 'test', rearm: false });
  updateGame(game, idle, .01); updateGame(game, idle, .01);
  assert.equal(game.groundItems.length, 1);
  const full = ofType(game, 'bag-full');
  assert.equal(full.length, 1); assert.equal(full[0].notice, ITEM_RULES.bagFullNotice);
  assert.equal(dropItem(game, 0).ok, true);
  assert.equal(game.groundItems.length, 2);
  updateGame(game, idle, .01);
  assert.equal(game.inventory.bag[0], null, 'neither item returns while the monk stands on them');
  Object.assign(game.player, { x: 0, y: -38 }); updateGame(game, idle, .01);
  Object.assign(game.player, { x: 0, y: -35 }); updateGame(game, idle, .01);
  assert.equal(game.inventory.bag[0].id, 'ground-test');
  assert.deepEqual(ofType(game, 'loot-pickup').map(e => e.id), ['ground-test']);
  assert.equal(ofType(game, 'bag-full').length, 2, 'the dropped filler now meets a full bag');
});

test('equipping changes the series: knuckles strike 4 times, the staff 3, bare hands as before', () => {
  for (const [family, damage] of [['knuckles', [19, 21, 25, 47, 19]], ['staff', [34, 38, 70, 34]], [null, [24, 30, 48, 24]]]) {
    const { game, enemy } = arena(), target = enemy(.6, 0);
    if (family) equip(game, weapon(family));
    const strikes = damage.map(() => strike(game, 1, 0, target));
    assert.deepEqual(strikes.map(s => s.index), [...damage.keys()].map(i => i % (family === 'knuckles' ? 4 : 3)), String(family));
    assert.deepEqual(strikes.map(s => s.damage[0]), damage, String(family));
  }
  const { game } = arena();
  equip(game, weapon('staff'));
  assert.ok(ofType(game, 'equip').length === 1);
  assert.equal(unequipItem(game).ok, true);
  assert.equal(game.inventory.equipped.weapon, null);
  assert.equal(ofType(game, 'equip').at(-1).item, null);
});

test('knuckles «Пробой»: the 4th strike deals ×1.5 to a shell side, back or stun, never through its front', () => {
  for (const [label, dx, dy, exposed, expected] of [
    ['back', 1, 0, false, Math.round(47 * 1.5)], ['side', 0, 1, false, Math.round(47 * 1.5)],
    ['stunned', -1, 0, true, Math.round(47 * 1.5)], ['front', -1, 0, false, Math.round(47 * BEETLE_STATS.blockDamage)],
  ]) {
    const { game, beetle } = arena(), shell = beetle(.8, 0, { dx, dy, exposed, ...(exposed ? { state: 'stunned', timer: 100 } : {}) });
    equip(game, weapon('knuckles'));
    Object.assign(game.player, { combo: 3, comboTimer: 1 });
    const { index, damage } = strike(game);
    assert.equal(index, 3, label);
    assert.deepEqual(damage, [expected], label);
    assert.equal(shell.hp, 500 - expected);
  }
});

test('staff «Сбивание»: its arc destroys wraith shots, and the 3rd strike reaches all the way round', () => {
  for (const family of ['staff', null]) {
    const { game } = arena();
    if (family) equip(game, weapon(family));
    game.projectiles.push({ id: 'incoming', x: 1.5, y: 0, dx: -1, dy: 0, radius: WRAITH_STATS.shotRadius, life: 2, damage: 12 });
    strike(game);
    advance(game, .3);
    assert.equal(game.player.hp, family ? 100 : 88, String(family));
    assert.equal(ofType(game, 'shot-destroyed').length, family ? 1 : 0);
  }
  const { game, enemy } = arena(), behind = enemy(-1, 0);
  equip(game, weapon('staff'));
  Object.assign(game.player, { combo: 2, comboTimer: 1 });
  assert.deepEqual(strike(game).damage, [70]);
  assert.equal(behind.hp, 430);
});

test('combo damage multiplies level, weapon power and the combo affix (§6.1, table 6.3)', () => {
  const { game, enemy } = arena(), target = enemy(.8, 0);
  gainXp(game, 840);
  equip(game, createItem({ id: 'ash', family: 'staff', ilvl: 2, rarity: 'rare', affixes: ['comboDamage', 'maxHp'] }));
  assert.deepEqual([0, 1, 2].map(() => strike(game, 1, 0, target).damage[0]), [48, 53, 98]);
  assert.equal(game.player.maxHp, 132 + 14, 'the health affix raises the maximum');
});

test('monster level 2 in the courtyard scales health and hits; the road stays at level 1', () => {
  const game = createAdventure();
  for (const e of game.enemies.filter(e => e.kind !== 'ritual')) {
    // The cemetery has level 2, the orchard level 3.
    const level = { road: 1, courtyard: 2, cemetery: 2, orchard: 3 }[e.zoneId];
    assert.equal(e.level, level, e.id);
    assert.equal(e.maxHp, { 1: { hound: 64, wraith: 76, beetle: 160 }, 2: { hound: 76, wraith: 90, beetle: 189 },
      3: { hound: 87, wraith: 103, beetle: 218 } }[level][e.kind]);
  }
  assert.equal(game.enemies.find(e => e.kind === 'ritual').maxHp, 132, 'the source is not a monster');
  for (const [zone, expected] of [['courtyard', 17], ['road', 16]]) {
    const run = createAdventure(), hound = run.enemies.find(e => e.zoneId === zone && e.kind === 'hound');
    run.enemies = [hound];
    Object.assign(run.player, { x: hound.x, y: hound.y, invulnerable: 0 });
    Object.assign(hound, { x: hound.x + .2, state: 'leap', timer: .2, dx: -1, dy: 0, hit: false, active: true });
    updateGame(run, {}, .01);
    assert.equal(run.player.hp, 100 - expected, zone);
  }
  const run = createAdventure(), wraith = run.enemies.find(e => e.zoneId === 'courtyard' && e.kind === 'wraith');
  run.enemies = [wraith];
  Object.assign(run.player, { x: wraith.x + 2, y: wraith.y, invulnerable: 100 });
  Object.assign(wraith, { state: 'windup', timer: .005, dx: 1, dy: 0, active: true });
  updateGame(run, {}, .01);
  assert.equal(run.projectiles[0].damage, 13);
});

test('the wraith has one health source: MONK_RULES.enemyHp', () => {
  assert.equal('hp' in WRAITH_STATS, false);
  const road = createAdventure().enemies.find(e => e.zoneId === 'road' && e.kind === 'wraith');
  assert.equal(road.hp, MONK_RULES.enemyHp.wraith);
});

test('a new run resets level, bag, loadout and cooldowns; the same seed rolls the same loot', () => {
  const game = createAdventure({}, { seed: 5 });
  gainXp(game, 600); equip(game, weapon('staff'));
  game.player.cooldowns.palm = 3;
  const fresh = createAdventure({}, { seed: 5 });
  assert.deepEqual(fresh.progression, { xp: 0, level: 1, path: [] });
  assert.deepEqual(fresh.inventory.bag, Array(8).fill(null)); assert.equal(fresh.inventory.equipped.weapon, null);
  assert.deepEqual(fresh.loadout, createLoadout()); assert.deepEqual(fresh.player.cooldowns, {});
  assert.deepEqual([fresh.player.maxHp, fresh.player.maxSpirit], [100, 100]);
  assert.deepEqual(fresh.groundItems, []); assert.deepEqual(fresh.lootClaimed, []);
  assert.deepEqual(fresh.loot, game.loot);
});

test('clearing all six packs drops six items on walkable ground and earns the expanded-route experience', () => {
  const game = createAdventure();
  for (const packId of ['road-approach', 'road-thicket', 'road-crossing', 'road-gate', 'court-entrance', 'court-source']) {
    for (const e of game.enemies.filter(e => e.packId === packId)) if (e.hp > 0) waveKill(game, e);
  }
  // The full clear also takes the wanderers; they drop no items (§4.3). The side zones' monsters
  // are optional and stay.
  const spine = e => e.zoneId === 'road' || e.zoneId === 'courtyard';
  for (const e of game.enemies.filter(e => e.wander && spine(e))) if (e.hp > 0) waveKill(game, e);
  assert.equal(game.groundItems.length, 6);
  for (const ground of game.groundItems) assert.ok(isWalkable(ground.x, ground.y, .1, game.world), ground.id);
  assert.equal(game.adventure.totalKills, game.enemies.filter(e => e.kind !== 'ritual' && spine(e)).length);
  assert.equal(game.progression.level, levelForXp(game.progression.xp));
  assert.ok(game.progression.xp >= 980 && game.progression.xp <= 1180, 'the expanded spine reaches its band before the source');
});

test('input queues RMB, Q and F as technique slot actions, once per physical press', t => {
  const priorWindow = globalThis.window, events = new EventTarget();
  globalThis.window = events;
  t.after(() => { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; });
  const canvas = new EventTarget();
  canvas.focus = () => {};
  const input = new Input(canvas, { screenToWorld: (x, y) => ({ x, y }) }, () => true);
  const send = (target, type, properties) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { repeat: false, ...properties });
    Object.defineProperty(event, 'target', { value: canvas });
    target.dispatchEvent(event);
    return event;
  };
  assert.equal(send(events, 'keydown', { code: 'KeyF' }).defaultPrevented, true);
  send(events, 'keydown', { code: 'KeyF', repeat: true });
  send(events, 'keydown', { code: 'KeyQ' });
  send(canvas, 'pointerdown', { button: 2, clientX: 4, clientY: 5, pointerType: 'mouse' });
  assert.deepEqual(input.sample({ x: 0, y: 0, dx: 1, dy: 0 }).actions, ['slot:f', 'slot:q', 'slot:rmb']);
  assert.deepEqual(input.sample({ x: 0, y: 0, dx: 1, dy: 0 }).actions, []);
});
