import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createAdventure, updateGame, startAttack, startDash, useSlot, getInteractionPrompt, interact } from '../src/game.js';
import { CAMP_SUPPLIES, LOCATIONS, ADVENTURE_RULES } from '../src/campaign.js';
import { createItem, pickUpItem } from '../src/items.js';
import { gainXp, assignSkill, chooseSkillModifier, slotStates, spendPathPoint, respecPath } from '../src/run-progress.js';
import { equipItem, unequipItem } from '../src/inventory-actions.js';
import { findPath, isWalkable } from '../src/world.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
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
  return { game, enemy };
}
const advance = (game, seconds, input = idle) => { for (let i = 0; i < Math.round(seconds / .01); i++) updateGame(game, input, .01); };
function equip(game, item) {
  const { slot } = pickUpItem(game.inventory, item);
  assert.equal(equipItem(game, slot).ok, true);
}

test('wanderers give monster experience only: no pack bonus, notice or item', () => {
  const { game, enemy } = arena();
  const a = enemy(1, 0, 1, { packId: 'wander-1', wander: true }), b = enemy(1, .3, 1, { packId: 'wander-1', wander: true });
  assert.equal(startAttack(game, 1, 0), true);
  advance(game, .2);
  assert.deepEqual([a.hp, b.hp], [0, 0]);
  assert.deepEqual(ofType(game, 'xp').map(e => [e.source, e.amount]), [['hound', 10], ['hound', 10]]);
  assert.equal(ofType(game, 'pack-cleared').length, 0);
  assert.equal(game.progression.xp, 20);
});

test('courtyard wanderers do not hold the ritual seal; the courtyard guards do', () => {
  const game = createAdventure();
  const ritual = game.enemies.find(e => e.kind === 'ritual');
  const guards = game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual');
  const wanderer = { ...guards[0], id: 'wander-test-1', packId: 'wander-test', wander: true, hp: 50 };
  game.enemies.push(wanderer);
  const [kept, ...rest] = guards.filter(e => !e.wander);
  for (const e of rest) e.hp = 0;
  updateGame(game, idle, .01);
  assert.equal(ritual.sealed, true, 'one living guard keeps the seal');
  kept.hp = 0;
  updateGame(game, idle, .01);
  assert.equal(ritual.sealed, false, 'a living wanderer leaves the seal open');
  assert.equal(ofType(game, 'ritual-open').length, 1);
});

test('a mark burst that kills the last pack monster clears the pack once', () => {
  const { game, enemy } = arena();
  enemy(1, 0, 1, { packId: 'p1', mark: { t: 3, radius: 2, damage: 40 } });
  const last = enemy(2.5, 0, 1, { packId: 'p1' });
  assert.equal(startAttack(game, 1, 0), true);
  advance(game, .2);
  assert.equal(last.hp, 0);
  assert.deepEqual(ofType(game, 'xp').map(e => [e.source, e.amount]), [['hound', 10], ['hound', 10], ['pack', 15]]);
  assert.equal(ofType(game, 'pack-cleared').length, 1);
  assert.equal(game.progression.xp, 35);
});

test('a swing keeps the weapon power and affixes it started with', () => {
  const { game, enemy } = arena(), target = enemy(.8, 0);
  equip(game, createItem({ id: 'k', family: 'knuckles' }));
  const { slot } = pickUpItem(game.inventory, createItem({ id: 's', family: 'staff', ilvl: 3, rarity: 'rare',
    affixes: ['comboDamage', 'spiritPerStrike'] }));
  game.player.spirit = 0;
  assert.equal(startAttack(game, 1, 0), true);
  updateGame(game, idle, .01);
  assert.equal(equipItem(game, slot).ok, true, 'the staff goes on before the strike lands');
  advance(game, .2);
  assert.equal(target.hp, 500 - 19, 'the first knuckle strike, not 19 × 1.2 × 1.12');
  assert.equal(game.player.spirit, 10, 'the knuckles spirit without the staff affix');
});

test('slots are not ready during the stance, the crane flight or the whiff lockout', () => {
  const { game } = arena();
  gainXp(game, 840);
  assignSkill(game, 'q', 'deflect');
  Object.assign(game.player, { spirit: 100, cooldowns: {}, waveCooldown: 0 });
  const ready = () => Object.fromEntries(slotStates(game).map(s => [s.slot, s.ready]));
  assert.deepEqual([ready().q, ready().rmb, ready().f], [true, true, true]);
  assert.equal(useSlot(game, 'q').ok, true);
  assert.deepEqual([ready().rmb, ready().f], [false, false]);
  assert.equal(useSlot(game, 'rmb').reason, 'busy');
  advance(game, .41);
  assert.ok(game.player.lockout > 0);
  assert.deepEqual([ready().rmb, ready().f], [false, false], 'the whiff lockout');
  advance(game, .36);
  assert.deepEqual([ready().rmb, ready().f], [true, true]);
  assert.equal(useSlot(game, 'f', 3, 0).ok, true);
  assert.equal(ready().rmb, false, 'the crane flight');
  assert.equal(useSlot(game, 'rmb').reason, 'busy');
  advance(game, .41);
  assert.equal(ready().rmb, true);
});

test('a technique learned without a free slot enters its first slot ready; later slotting restarts it', () => {
  const { game } = arena(), p = game.player;
  gainXp(game, 840);
  assert.deepEqual(game.newTechniques, ['deflect']);
  assert.equal(assignSkill(game, 'q', 'deflect').ok, true);
  assert.equal(p.cooldowns.deflect, 0);
  assert.deepEqual(ofType(game, 'loadout').at(-1).restarted, []);
  assert.deepEqual(game.newTechniques, []);
  assert.deepEqual(useSlot(game, 'q'), { ok: true, skill: 'deflect' });
  advance(game, .8);
  p.cooldowns = {};
  assert.equal(assignSkill(game, 'q', 'palm').ok, true);
  assert.equal(p.cooldowns.palm, .5, 'the palm was slotted before: full cooldown');
  assert.equal(assignSkill(game, 'q', 'deflect').ok, true);
  assert.equal(p.cooldowns.deflect, 3, 'the second slotting keeps the §2.8 cooldown');

  const later = arena().game;
  gainXp(later, 1510);
  assert.deepEqual(later.newTechniques, ['deflect', 'bell']);
  assert.equal(chooseSkillModifier(later, 'deflect', 'wideStance').ok, true);
  assert.equal(later.player.cooldowns.deflect, 3, 'a modifier change restarts it while unslotted');
  assert.equal(assignSkill(later, 'rmb', 'deflect').ok, true);
  assert.equal(later.player.cooldowns.deflect, 0, 'its first slot still starts it ready');
  assert.deepEqual(later.newTechniques, ['bell']);
  assert.deepEqual(createGame().newTechniques, [], 'a new run starts with none');
});

test('a pickup heals by the heal of the moment it is taken («Второе дыхание»)', () => {
  const { game } = arena();
  gainXp(game, 450);
  game.pickups.push({ id: 'health-old', x: 3, y: 0, amount: 18 });
  assert.equal(spendPathPoint(game, 'tempering').ok, true);
  assert.equal(spendPathPoint(game, 'second-wind').ok, true);
  game.player.hp = 50;
  Object.assign(game.player, { x: 3, y: 0 });
  updateGame(game, idle, .01);
  assert.equal(game.player.hp, 76);
  assert.equal(ofType(game, 'heal').at(-1).amount, 26);
});

test('«Шаг духа» counts monsters, never the ritual source', () => {
  for (const [kind, spirit] of [['ritual', 10], ['hound', 16]]) {
    const { game, enemy } = arena();
    gainXp(game, 220);
    assert.equal(chooseSkillModifier(game, 'dash', 'spiritStep').ok, true);
    enemy(1.5, 0, 500, { kind, sealed: false, state: kind === 'ritual' ? 'idle' : 'stunned' });
    Object.assign(game.player, { spirit: 10, dashCooldown: 0 });
    assert.equal(startDash(game, 1, 0), true);
    advance(game, .25);
    assert.equal(game.player.spirit, spirit, kind);
  }
});

test('a palm flies ahead and never hits a monster behind the monk', () => {
  const { game, enemy } = arena(), behind = enemy(-.35, 0), ahead = enemy(4, 0, 500, { kind: 'wraith' });
  gainXp(game, 80);
  assert.equal(useSlot(game, 'q', 4, 0).ok, true);
  advance(game, .6);
  assert.equal(behind.hp, 500);
  assert.equal(ahead.hp, 500 - Math.round(40 * 1.04));
});

test('at the level cap the xp event reports only the experience granted', () => {
  const { game } = arena();
  gainXp(game, 13430);
  game.events.length = 0;
  assert.equal(gainXp(game, 30), 10);
  assert.deepEqual(ofType(game, 'xp').map(e => e.amount), [10]);
  assert.equal(game.progression.xp, 13440);
  assert.equal(gainXp(game, 30), 0);
  assert.equal(ofType(game, 'xp').length, 1, 'nothing granted sends no event');
});

test('«Закалка» raises current health with the maximum; a respec takes it back', () => {
  const { game } = arena(), p = game.player;
  gainXp(game, 80);
  assert.deepEqual([p.hp, p.maxHp], [108, 108]);
  assert.equal(spendPathPoint(game, 'tempering').ok, true);
  assert.deepEqual([p.hp, p.maxHp], [123, 123]);
  p.hp = 50;
  assert.equal(respecPath(game).ok, true);
  assert.deepEqual([p.hp, p.maxHp], [35, 108]);
  assert.equal(spendPathPoint(game, 'tempering').ok, true);
  assert.deepEqual([p.hp, p.maxHp], [50, 123], 'respec and spend never heal');
  p.hp = 4;
  respecPath(game);
  assert.equal(p.hp, 1, 'a respec never drops health below 1');
});

test('a respec removes «Закалка» health once and keeps a living monk at least at 1 HP', async t => {
  for (const [hp, expectedHp] of [[123, 108], [115, 100], [50, 35], [15, 1], [4, 1], [1, 1]]) {
    await t.test(`${hp}/123 → ${expectedHp}/108`, () => {
      const { game } = arena(), p = game.player;
      gainXp(game, 80);
      assert.equal(spendPathPoint(game, 'tempering').ok, true);
      assert.equal(p.maxHp, 123);
      p.hp = hp;

      assert.equal(respecPath(game).ok, true);
      assert.deepEqual([p.hp, p.maxHp], [expectedHp, 108]);
    });
  }
});

test('unequipping with a full bag stays refused', () => {
  const { game } = arena();
  equip(game, createItem({ id: 'worn', family: 'staff' }));
  for (let i = 0; i < 8; i++) pickUpItem(game.inventory, createItem({ id: `filler-${i}`, family: 'knuckles' }));
  assert.deepEqual(unequipItem(game), { ok: false, reason: 'bag-full' });
  assert.equal(game.inventory.equipped.weapon.id, 'worn');
});

test('the camp supplies E point stands screen-down of the cache, outside it and reachable', () => {
  const cache = LOCATIONS.camp.setDressing.find(p => p.id === 'supplies').collider;
  const dx = CAMP_SUPPLIES.x - cache.x, dy = CAMP_SUPPLIES.y - cache.y;
  assert.ok(Math.abs(dx - dy) < 1e-9 && dx > 0, 'on the screen-down diagonal (world +x +y)');
  assert.ok(Math.max(Math.abs(dx) - cache.halfWidth, Math.abs(dy) - cache.halfDepth) >= .45 - 1e-9, 'outside the collider');
  const game = createAdventure(), p = game.player;
  assert.ok(isWalkable(CAMP_SUPPLIES.x, CAMP_SUPPLIES.y, p.radius, game.world));
  assert.ok(Math.hypot(CAMP_SUPPLIES.x - game.world.reward.x, CAMP_SUPPLIES.y - game.world.reward.y) > ADVENTURE_RULES.interactionRadius);
  assert.ok(findPath(game.world.spawn, CAMP_SUPPLIES, p.radius, game.world).length > 1, 'a walk from the camp spawn reaches it');
  Object.assign(p, CAMP_SUPPLIES);
  assert.equal(getInteractionPrompt(game), 'E — взять припасы');
  assert.equal(interact(game), true);
  assert.equal(game.inventory.bag.filter(Boolean).length, 2);
});
