import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MonkPanel, PANEL_TABS, PanelController, iconFile, itemIcon, pauseLegend, skillIcon } from '../src/monk-panel.js';
import { controlKeys } from '../src/gamepad.js';
import { createAdventure } from '../src/game.js';
import { Input } from '../src/input.js';
import { claimCampSupplies } from '../src/inventory-actions.js';
import { ITEM_RULES, createItem, pickUpItem } from '../src/items.js';
import { gainXp, skillCooldown } from '../src/run-progress.js';

const text = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// A level N run at the camp: experience goes through the real level-up path, so slots and techniques follow.
function run(level = 1, seed = 7) {
  const game = createAdventure({}, { seed });
  const xp = [0, 80, 220, 450, 840, 1510][level - 1];
  if (xp) gainXp(game, xp);
  game.events.length = 0;
  return { game, panel: new PanelController(() => game) };
}
const pursue = game => {
  const monster = game.enemies.find(enemy => enemy.kind !== 'ritual');
  Object.assign(monster, { active: true, returning: false });
  return monster;
};

test('C, I and K open their tab, close it on a second press, and Tab or Esc switch and close', () => {
  const { panel } = run();
  assert.equal(panel.isOpen, false);
  assert.equal(panel.key('KeyW'), null, 'other keys stay with the game');
  assert.equal(panel.key('KeyI'), 'open');
  assert.deepEqual([panel.isOpen, panel.tab], [true, 'gear']);
  assert.equal(panel.key('KeyK'), 'tab');
  assert.equal(panel.tab, 'skills');
  assert.equal(panel.key('KeyK'), 'close', 'the key of the shown tab closes the panel');
  assert.equal(panel.isOpen, false);
  // Tab opens the last tab, then cycles C → I → K and back; Shift+Tab goes the other way.
  assert.equal(panel.key('Tab'), 'open');
  assert.equal(panel.tab, 'skills');
  assert.equal(panel.key('Tab'), 'tab');
  assert.equal(panel.tab, 'character');
  assert.equal(panel.key('Tab', { shift: true }), 'tab');
  assert.equal(panel.tab, 'skills');
  assert.deepEqual(PANEL_TABS.map(() => { panel.key('Tab'); return panel.tab; }), ['character', 'gear', 'skills']);
  assert.equal(panel.key('Escape'), 'close');
  assert.equal(panel.isOpen, false);
  assert.equal(panel.key('Escape'), null, 'Esc with the panel closed is the pause key');
  panel.key('KeyC');
  assert.equal(panel.tab, 'character');
});

test('play input queues C, I, K and Tab once per press and keeps Tab from moving the browser focus', t => {
  const priorWindow = globalThis.window, events = new EventTarget();
  globalThis.window = events;
  t.after(() => { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; });
  const canvas = new EventTarget();
  canvas.focus = () => {};
  let active = true;
  const input = new Input(canvas, { screenToWorld: (x, y) => ({ x, y }) }, () => active);
  const key = (code, { target = canvas, ...extra } = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, repeat: false, ...extra });
    Object.defineProperty(event, 'target', { value: target });
    events.dispatchEvent(event);
    return event;
  };
  const sample = () => input.sample({ x: 0, y: 0, dx: 1, dy: 0 }).actions;
  assert.equal(key('Tab').defaultPrevented, true);
  key('Tab', { repeat: true });
  key('KeyC'); key('KeyI'); key('KeyK');
  assert.deepEqual(sample(), ['panel:next', 'panel:character', 'panel:gear', 'panel:skills']);
  assert.deepEqual(sample(), []);
  input.clear();
  active = false;
  assert.equal(key('KeyC').defaultPrevented, false, 'menus and the open panel handle their own keys');
  active = true;
  assert.equal(key('KeyI', { target: { tagName: 'INPUT' } }).defaultPrevented, false);
  assert.deepEqual(sample(), []);
});

test('«Персонаж» spends a path point on an open node and explains every refusal', () => {
  const { game, panel } = run(2);
  panel.open('character');
  let view = panel.characterView();
  assert.equal(view.points, 1);
  assert.deepEqual([view.level, view.xpText, view.toNext], [2, '80 / 220', 'до ур. 3 — 140']);
  assert.equal(view.nodes.find(node => node.id === 'tempering').status, 'available');
  assert.equal(view.focus.id, 'tempering', 'the first open node is described');
  assert.equal(view.focus.condition.text, 'ЛКМ — взять за 1 очко');
  assert.equal(panel.tabsView().points, 1, 'the «+1» mark on the «Персонаж» tab');

  const maxHp = game.player.maxHp;
  assert.equal(panel.spend('tempering').ok, true);
  assert.equal(game.player.maxHp, maxHp + 15, 'Закалка: +15 к здоровью');
  view = panel.characterView();
  assert.equal(view.points, 0);
  assert.equal(view.stats.find(stat => stat.label === 'Здоровье').value, String(maxHp + 15));
  assert.deepEqual(view.links.find(link => link.branch === 'body' && link.row === 1), { branch: 'body', row: 1, lit: true });

  assert.deepEqual(panel.spend('deep-breath'), { ok: false, reason: 'no-points' });
  assert.equal(panel.characterView().focus.condition.text, 'Нет свободных очков: очко даёт новый уровень');
  assert.deepEqual(panel.spend('second-wind'), { ok: false, reason: 'level' });
  assert.equal(panel.characterView().focus.condition.text, 'Откроется на ур. 4');
  gainXp(game, 370);
  assert.deepEqual(panel.spend('intercept'), { ok: false, reason: 'order' });
  assert.equal(panel.characterView().focus.condition.text, 'Сначала возьми «Твёрдая рука»');
  assert.deepEqual(game.progression.path, ['tempering']);
});

test('«Сбросить путь» refunds every point out of combat and is closed in combat (§4.6)', () => {
  const { game, panel } = run(4);
  panel.open('character');
  panel.spend('tempering'); panel.spend('second-wind'); panel.spend('deep-breath');
  assert.equal(panel.characterView().points, 0);

  const monster = pursue(game);
  let view = panel.characterView();
  assert.deepEqual(view.respec, { enabled: false, inCombat: true }, 'the button is closed with «Нельзя в бою» beside it');
  assert.deepEqual(panel.respec(), { ok: false, reason: 'in-combat', refunded: 0 });
  assert.deepEqual(game.progression.path, ['tempering', 'second-wind', 'deep-breath']);

  monster.returning = true;
  view = panel.characterView();
  assert.deepEqual(view.respec, { enabled: true, inCombat: false });
  const maxHp = game.player.maxHp;
  assert.deepEqual(panel.respec(), { ok: true, refunded: 3 });
  assert.deepEqual(game.progression.path, []);
  assert.equal(panel.characterView().points, 3);
  assert.equal(game.player.maxHp, maxHp - 15);
  assert.deepEqual(panel.characterView().respec, { enabled: false, inCombat: false }, 'nothing left to reset');
});

test('camp supplies open the first weapon choice; LMB equips and the old weapon takes the cell', () => {
  const { game, panel } = run();
  claimCampSupplies(game, game.player);
  panel.observe(game.events);
  panel.open('gear');
  let view = panel.gearView();
  assert.equal(view.firstChoice, true, '«Выбери оружие: ЛКМ — надеть»');
  assert.equal(view.count, '2 / 8');
  assert.equal(panel.focus.gear, 0, 'the first new item is compared at once');
  assert.deepEqual(view.cells.slice(0, 2).map(cell => [cell.item.family, cell.isNew]), [['knuckles', true], ['staff', true]]);
  assert.equal(view.equippedCard.name, 'Без оружия');
  assert.equal(view.chosen.card.delta.tone, 'better', 'bare hands compare as the same series');
  assert.match(view.summary[0].value, /▲$/);

  const [knuckles, staff] = game.inventory.bag;
  assert.equal(panel.equip(0).ok, true);
  assert.equal(game.inventory.equipped.weapon, knuckles);
  assert.equal(game.inventory.bag[0], null);
  view = panel.gearView();
  assert.equal(view.firstChoice, false);
  assert.deepEqual([view.weapon.family, view.equippedLabel], ['Кастеты', 'оружие вне сумки']);

  // A staff against knuckles: another family, so the damage delta is muted and the card says so.
  panel.hover(1);
  view = panel.gearView();
  assert.equal(view.chosen.card.delta.tone, 'muted');
  assert.deepEqual(view.chosen.card.trailing, { text: 'Другое оружие: иная серия и ритм', tone: 'muted', plain: true });
  assert.equal(panel.equip(1).ok, true);
  assert.deepEqual([game.inventory.equipped.weapon, game.inventory.bag[1]], [staff, knuckles], 'equipping swaps the weapons');
  assert.equal(game.events.filter(event => event.type === 'equip').length, 2);
  assert.deepEqual(panel.equip(5), { ok: false, reason: 'empty' });
});

test('a held RMB or Delete drops the item next to the monk, where it can be picked up again', () => {
  const { game, panel } = run();
  claimCampSupplies(game, game.player);
  panel.open('gear');
  const item = game.inventory.bag[1];
  assert.equal(ITEM_RULES.dropHoldTime, .6);
  assert.equal(panel.drop(1).ok, true);
  assert.equal(game.inventory.bag[1], null);
  const ground = game.groundItems.find(entry => entry.item === item);
  assert.ok(ground, 'the item lies on the ground');
  assert.equal(ground.rearm, true, 'it waits until the monk steps away');
  assert.ok(Math.hypot(ground.x - game.player.x, ground.y - game.player.y) <= .6);
  assert.equal(panel.gearView().count, '1 / 8');
  // Delete drops the hovered item; an empty cell has nothing to drop.
  panel.hover(0);
  assert.equal(panel.key('Delete'), 'drop');
  assert.equal(game.inventory.bag[0], null);
  assert.equal(game.groundItems.length, 2);
  assert.deepEqual(panel.drop(0), { ok: false, reason: 'empty' });
  assert.deepEqual(panel.gearView().chosen, { label: 'Наведено', cell: 'ячейка 1', empty: true, count: 'Сумка 0 / 8' });
});

test('a full bag reads 8 / 8 in coral and refuses to take the weapon off', () => {
  const { game, panel } = run();
  for (let i = 0; i < 8; i++) {
    assert.equal(pickUpItem(game.inventory, createItem({ id: `filler-${i}`, family: i % 2 ? 'staff' : 'knuckles' })).ok, true);
  }
  assert.equal(panel.equip(0).ok, true);
  assert.equal(pickUpItem(game.inventory, createItem({ id: 'filler-8', family: 'staff' })).ok, true, 'the swap left a free cell');
  panel.open('gear');
  const view = panel.gearView();
  assert.deepEqual([view.count, view.full], ['8 / 8', true]);
  assert.deepEqual(panel.unequip(), { ok: false, reason: 'bag-full' });
  assert.equal(panel.gearView().message, 'Сумка полна: некуда снять оружие');
  assert.ok(game.inventory.equipped.weapon);
  assert.deepEqual(pickUpItem(game.inventory, createItem({ id: 'filler-9', family: 'staff' })), { ok: false, reason: 'bag-full' });
  // Dropping one makes room; then the weapon comes off and the default series returns.
  panel.drop(3);
  assert.equal(panel.unequip().ok, true);
  assert.equal(game.inventory.equipped.weapon, null);
  assert.equal(panel.gearView().weapon.family, 'Без оружия');
});

test('item cards compare damage per second, affixes and relic lines with the equipped weapon', () => {
  const { game, panel } = run(4);
  const worn = createItem({ id: 'worn', family: 'knuckles', ilvl: 2, rarity: 'rare', affixes: ['comboDamage', 'maxHp'] });
  const relic = createItem({ id: 'relic', family: 'knuckles', ilvl: 2, rarity: 'relic', relic: 'quiet-thunder',
    affixes: ['comboDamage', 'cooldownReduction'] });
  game.inventory.equipped.weapon = worn;
  pickUpItem(game.inventory, relic);
  panel.open('gear');
  panel.hover(0);
  const { chosen, equippedCard } = panel.gearView();
  assert.deepEqual([chosen.label, chosen.cell], ['Выбрано', 'ячейка 1']);
  assert.equal(equippedCard.family, 'Кастеты · УП 2 · мощь 110%');
  assert.equal(chosen.card.name, 'Тихий гром');
  assert.equal(chosen.card.gems, 2);
  assert.deepEqual(chosen.card.special, ['Пробой', '4-й удар в спину ×1,5']);
  assert.deepEqual(chosen.card.affixes.map(affix => [affix.text, affix.compare.text]),
    [['Урон серии +10%', '= надето'], ['Перезарядка −7%', '▲ новое']]);
  assert.deepEqual(chosen.card.trailing, { text: '4-й удар бьёт ещё 2 цели: 50%', tone: 'amber' });
  assert.equal(chosen.card.delta.text, '= как надето');
  assert.equal(itemIcon(relic), 'relic-quiet-thunder');
});

test('«Умения»: Q or F over a technique row slots it, the old one goes without a slot; swaps restart both', () => {
  const { game, panel } = run(5);
  assert.deepEqual(game.loadout.slots, { lmb: 'combo', space: 'dash', rmb: 'wave', q: 'palm', f: 'crane' });
  panel.observe([{ type: 'technique-learned', technique: 'deflect', slot: null }]);
  panel.open('skills');
  let view = panel.skillsView();
  const row = id => view.rows.find(entry => entry.id === id);
  assert.deepEqual([row('deflect').status, row('deflect').isNew], ['unslotted', true]);
  assert.equal(view.detail.id, 'deflect', 'a new technique is described first');
  assert.equal(view.detail.kind, 'техника', 'the list row and the text say «без слота»');
  assert.equal(row('bell').status, 'locked');
  assert.equal(row('combo').key, 'ЛКМ');

  panel.hover('deflect');
  assert.equal(panel.key('KeyQ'), 'assign');
  assert.deepEqual(game.loadout.slots, { lmb: 'combo', space: 'dash', rmb: 'wave', q: 'deflect', f: 'crane' });
  view = panel.skillsView();
  assert.equal(row('palm').status, 'unslotted');
  assert.equal(row('deflect').key, 'Q');
  assert.equal(skillCooldown(game, 'deflect'), 0, 'a newly learned technique enters its first slot ready (§2.9.8)');

  // The second way: LMB on a row, then LMB on a slot. A slotted technique swaps slots and both restart.
  assert.equal(panel.pick('crane'), true);
  assert.equal(panel.skillsView().picked, 'Прыжок журавля');
  assert.deepEqual(panel.skillsView().slots.filter(slot => slot.target).map(slot => slot.id), ['rmb', 'q', 'f']);
  assert.equal(panel.clickSlot('rmb').ok, true);
  assert.deepEqual([game.loadout.slots.rmb, game.loadout.slots.f], ['crane', 'wave']);
  assert.ok(skillCooldown(game, 'wave') > 0 && skillCooldown(game, 'crane') > 0);
  assert.equal(panel.picked, null);
  // RMB over a row is the same as Q or F, and a later slotting restarts the cooldown (§2.8).
  game.player.cooldowns.palm = 0;
  assert.equal(panel.assign('rmb', 'palm').ok, true);
  assert.equal(game.loadout.slots.rmb, 'palm');
  assert.ok(skillCooldown(game, 'palm') > 0);
  // Esc drops a pick before it closes the panel.
  panel.pick('deflect');
  assert.equal(panel.key('Escape'), 'cancel');
  assert.equal(panel.isOpen, true);
  assert.equal(panel.pick('bell'), false, 'a locked technique cannot be picked');
  assert.equal(panel.pick('combo'), false, 'the series stays on LMB');
});

test('slot refusals name the level, and an open slot keeps working in combat', () => {
  const { game, panel } = run(1);
  panel.open('skills');
  assert.deepEqual(panel.assign('q', 'wave'), { ok: false, reason: 'slot-locked' });
  assert.equal(panel.skillsView().message, 'Слот Q откроется на ур. 2');
  assert.deepEqual(panel.assign('rmb', 'palm'), { ok: false, reason: 'technique-locked' });
  assert.equal(panel.skillsView().message, 'Ладонь духа откроется на ур. 2');
  gainXp(game, 80);
  pursue(game);
  assert.equal(panel.assign('rmb', 'palm').ok, true, 'slots change in combat too (§2.8)');
  assert.deepEqual(game.loadout.slots.q, 'wave');
});

test('a modifier is chosen, restarts its skill, and a second click clears it; locked ones explain the level', () => {
  const { game, panel } = run(1);
  panel.open('skills');
  panel.hover('wave');
  let detail = panel.skillsView().detail;
  assert.deepEqual(detail.modifiers.map(modifier => [modifier.name, modifier.locked]),
    [['Тяжёлая волна', true], ['Вихревая волна', true], ['Волна покоя', true]]);
  assert.deepEqual(panel.chooseModifier('wave', 'heavyWave'), { ok: false, reason: 'modifier-locked' });
  assert.equal(panel.skillsView().message, 'Модификаторы откроются на ур. 3');

  gainXp(game, 220);
  game.player.waveCooldown = 0;
  assert.equal(panel.chooseModifier('wave', 'heavyWave').ok, true);
  assert.equal(game.loadout.modifiers.wave, 'heavyWave');
  assert.ok(game.player.waveCooldown > 0, 'the changed skill goes on full cooldown');
  detail = panel.skillsView().detail;
  assert.deepEqual(detail.modifiers.map(modifier => modifier.selected), [true, false, false]);
  assert.equal(detail.numbers.find(cell => cell.label === 'Радиус').value, '2,6 ед.');
  assert.match(detail.modifiers[0].text, /^Радиус 3,4 → 2,6 ед\. Урон \d+ → \d+\.$/);
  assert.equal(panel.chooseModifier('wave', 'heavyWave').ok, true);
  assert.equal(game.loadout.modifiers.wave, null, 'one modifier or none');
  panel.hover('combo');
  assert.deepEqual(panel.skillsView().detail.modifiers, [], 'the weapon changes the series');
});

test('the «новое» dot stays while the pointer is on the item and goes out when it leaves', () => {
  const { game, panel } = run();
  const item = createItem({ id: 'fresh', family: 'staff' });
  pickUpItem(game.inventory, item);
  panel.observe([{ type: 'loot-pickup', item }]);
  panel.open('gear');
  assert.equal(panel.gearView().cells[0].isNew, true);
  assert.equal(panel.gearView().chosen.isNew, true, '«Выбрано · новое»');
  panel.hover(4);
  assert.equal(panel.gearView().cells[0].isNew, false);
  panel.reset();
  assert.equal(panel.isOpen, false);
});

test('the pause legend names the techniques in RMB, Q and F', () => {
  const { game } = run(1);
  assert.deepEqual(pauseLegend(game).map(row => [row.slot, row.locked, row.text]), [
    ['rmb', false, 'волна духа: круговая волна · 40 духа'],
    ['q', true, 'вторая техника · откроется на ур. 2'],
    ['f', true, 'третья техника · откроется на ур. 4'],
  ]);
  gainXp(game, 80);
  assert.equal(pauseLegend(game)[1].text, 'ладонь духа: дальний удар · 20 духа');
});

test('on the pad the panel names the pad buttons: ✕ takes, slot keycaps and kinds follow the family', () => {
  const { panel } = run(2);
  assert.equal(panel.keys, controlKeys(null), 'the keyboard names come first');
  panel.keys = controlKeys('playstation');
  panel.open('character');
  assert.equal(panel.characterView().focus.condition.text, '✕ — взять за 1 очко');
  panel.show('skills');
  let view = panel.skillsView();
  assert.deepEqual(view.slots.map(slot => slot.label), ['R2', '✕', '□', '△', '○']);
  assert.deepEqual(['combo', 'dash', 'wave', 'palm'].map(id => view.rows.find(row => row.id === id).key), ['R2', '✕', '□', '△']);
  assert.equal(view.detail.kind, 'техника · □');
  panel.hover('combo', 'skills');
  assert.equal(panel.skillsView().detail.kind, 'серия · R2');
  panel.keys = controlKeys('xbox');
  panel.hover('dash', 'skills');
  view = panel.skillsView();
  assert.equal(view.detail.kind, 'шаг · A');
  assert.deepEqual(view.slots.map(slot => slot.label), ['RT', 'A', 'X', 'Y', 'B']);
  // An empty slot in the pause legend names the panel button of the device.
  const empty = { loadout: { slots: { rmb: null }, modifiers: {} } };
  assert.deepEqual([null, 'playstation', 'xbox'].map(family => pauseLegend(empty, controlKeys(family))[0].text),
    ['пусто · K — умения', 'пусто · Create — умения', 'пусто · View — умения']);
});

test('a held RMB or □ (X) on a bag item drops it after the hold time; a release before that keeps it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { game } = run();
  claimCampSupplies(game, game.player);
  const panel = new MonkPanel({ addEventListener() {} }, { getGame: () => game, doc: { getElementById: () => null } });
  const cell = (slot, empty = false) => {
    const classes = new Set(empty ? ['empty'] : []);
    return { dataset: { bag: String(slot) }, classes,
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) } };
  };
  const [first, second] = game.inventory.bag;
  assert.ok(first && second, 'the camp supplies fill two cells');
  assert.equal(panel.holdDrop(cell(2, true)), false, 'an empty cell has nothing to hold');
  assert.equal(panel.holdDrop({ dataset: { skill: 'palm' } }), false, 'a technique row is not a bag item');
  assert.equal(panel.holdDrop(null), false);
  const held = cell(1);
  assert.equal(panel.holdDrop(held), true);
  assert.equal(held.classes.has('holding'), true, 'the cell shows the hold');
  t.mock.timers.tick(ITEM_RULES.dropHoldTime * 1000 - 1);
  assert.equal(game.inventory.bag[1], second, 'not yet');
  t.mock.timers.tick(1);
  assert.equal(game.inventory.bag[1], null, 'the full hold drops the item');
  assert.equal(held.classes.has('holding'), false);
  const early = cell(0);
  panel.holdDrop(early);
  t.mock.timers.tick(300);
  panel.release();
  t.mock.timers.tick(ITEM_RULES.dropHoldTime * 1000);
  assert.equal(game.inventory.bag[0], first, 'a release before the hold time keeps the item');
  assert.equal(early.classes.has('holding'), false);
});

test('pixel icons come from pixel-v5 at --u × art scale × devicePixelRatio, at most 4×', () => {
  const file = url => fileURLToPath(url);
  assert.match(iconFile('skill-palm', 2), /skill-palm@2x\.png$/);
  assert.match(iconFile('skill-palm', 4), /skill-palm@4x\.png$/);
  assert.match(iconFile('skill-palm', 6), /skill-palm@4x\.png$/, 'larger screens scale the 4× file without smoothing');
  assert.match(iconFile('skill-palm', 1), /skill-palm@1x\.png$/);
  assert.equal(skillIcon('combo'), 'skill-combo-bare');
  assert.equal(skillIcon('combo', { family: 'staff' }), 'skill-combo-staff');
  for (const id of ['dash', 'wave', 'palm', 'crane', 'deflect', 'bell', 'mantra', 'sevenStrikes']) {
    assert.ok(existsSync(file(iconFile(skillIcon(id), 2))), id);
  }
  assert.ok(existsSync(file(iconFile(itemIcon(createItem({ id: 'a', family: 'staff', ilvl: 2 })), 4))));
});

test('the panel markup and styles keep one 288×208u frame with tabs C · I · K and the paused HUD', () => {
  const html = text('../index.html'), css = text('../src/styles.css');
  const markup = html.match(/<div id="monk-panel"[\s\S]*?<\/section>/)[0];
  assert.match(markup, /class="monk-layer" hidden/);
  for (const [tab, label, key] of [['character', 'Персонаж', 'C'], ['gear', 'Снаряжение', 'I'], ['skills', 'Умения', 'K']]) {
    assert.match(markup, new RegExp(`id="monk-tab-${tab}"[^>]*role="tab"[^>]*><span>${label}</span><kbd>${key}</kbd>`), tab);
  }
  assert.match(markup, /id="monk-tab-points" class="monk-tab-points" hidden>\+1</);
  assert.match(markup, /Tab — вкладки/);
  assert.match(markup, /id="monk-close"[^>]*>Esc</);
  assert.match(markup, /id="monk-content" class="monk-content" role="tabpanel"/);
  for (const id of ['mark-new', 'lock-small', 'lock-badge', 'lock-hint', 'gear-beads', 'gear-robe', 'gear-belt', 'gear-wraps']) {
    assert.match(html, new RegExp(`<g id="${id}">`), id);
  }
  assert.match(css, /\.monk-panel \{[^}]*width: calc\(var\(--u\) \* 288\);\s*height: calc\(var\(--u\) \* 208\);[^}]*padding: calc\(var\(--u\) \* 7\) calc\(var\(--u\) \* 8\);/);
  assert.match(css, /\.monk-panel \{[^}]*--frame-top: #8d7f99;\s*--frame-fill: var\(--ink\);/);
  // Three tabs share one side padding: no tab sets its own.
  assert.doesNotMatch(css, /\.tab-(character|gear|skills)[^{]*\{[^}]*padding(-left|-right|-inline)?:/);
  const legend = html.match(/<div id="pause-controls"[\s\S]*?<\/div>/)[0];
  assert.match(legend, /<kbd>C \/ I \/ K<\/kbd> монах: персонаж · снаряжение · умения/);
  assert.match(legend, /id="legend-q" class="locked"><kbd>Q<\/kbd>/);
  assert.match(legend, /id="legend-f" class="locked"><kbd>F<\/kbd>/);
});

// A control the panel clicks: closest() finds itself, classList reads its classes.
const control = (data, classes = []) => {
  const own = new Set(classes);
  const element = { dataset: data, classList: { contains: name => own.has(name), add: name => own.add(name), remove: name => own.delete(name) } };
  element.closest = () => element;
  return element;
};

test('with the touch labels a tap only chooses; «Взять», «Надеть», «Снять» and a held «Держи — выбросить» act (mobile-touch §12)', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { game } = run(2);
  claimCampSupplies(game, game.player);
  const panel = new MonkPanel({ addEventListener() {} }, { getGame: () => game, doc: { getElementById: () => null } });
  const c = panel.controller;
  c.keys = controlKeys('touch');
  // The controller stays closed: MonkPanel draws nothing without a DOM; the tab is «Персонаж».
  const click = data => panel.click({ target: control(data) });
  // «Персонаж»: the node is described, the point stays until «Взять».
  const node = c.characterView().focus;
  assert.equal(node.status, 'available');
  click({ node: node.id });
  assert.deepEqual(game.progression.path, [], 'a tap on a node only chooses it');
  const view = c.characterView();
  assert.equal(view.take, node.id);
  assert.match(view.focus.condition.text, /«Взять» — за 1 очко$/);
  click({ take: node.id });
  assert.deepEqual(game.progression.path, [node.id]);
  assert.equal(c.characterView().take, null, 'no point left');
  // «Снаряжение»: a bag cell is chosen, «Надеть» equips it, the weapon slot shows the worn weapon with «Снять».
  const [first] = game.inventory.bag;
  c.show('gear');
  click({ bag: '0' });
  assert.equal(game.inventory.bag[0], first, 'a tap on a cell only chooses it');
  assert.deepEqual([c.gearView().chosen.label, c.gearView().chosen.card.name], ['Выбрано', first.name]);
  click({ equip: '0' });
  assert.equal(game.inventory.equipped.weapon, first);
  click({ weapon: '' });
  const worn = c.gearView().chosen;
  assert.deepEqual([worn.label, worn.cell, worn.worn, worn.card.name], ['Надето', 'оружие', true, first.name]);
  assert.equal(game.inventory.equipped.weapon, first, 'a tap on the slot only chooses it');
  click({ unequip: '' });
  assert.equal(game.inventory.equipped.weapon, null);
  click({ bag: '7' });
  assert.deepEqual([c.gearView().chosen.label, c.gearView().chosen.empty], ['Выбрано', true], 'an empty cell is chosen, not «наведено»');
  // A finger held on «Держи — выбросить» drops the chosen item after the hold time.
  const filled = game.inventory.bag.findIndex(Boolean), item = game.inventory.bag[filled];
  const drop = control({ drop: String(filled) });
  panel.press({ target: drop, button: 0, preventDefault() {} });
  assert.equal(drop.classList.contains('holding'), true);
  t.mock.timers.tick(ITEM_RULES.dropHoldTime * 1000 - 1);
  assert.equal(game.inventory.bag[filled], item);
  t.mock.timers.tick(1);
  assert.equal(game.inventory.bag[filled], null);
  // The keyboard keeps the old gestures: a click on a node spends at once.
  const desktop = run(2);
  const mouse = new MonkPanel({ addEventListener() {} }, { getGame: () => desktop.game, doc: { getElementById: () => null } });
  const id = mouse.controller.characterView().focus.id;
  mouse.click({ target: control({ node: id }) });
  assert.deepEqual(desktop.game.progression.path, [id]);
  assert.equal(mouse.controller.characterView().take, null);
});

test('the touch «Умения» hints name the buttons 1, 2, 3 and never a key', () => {
  const { game } = run(4);
  const panel = new PanelController(() => game);
  panel.keys = controlKeys('touch');
  panel.open('skills');
  const rows = panel.skillsView().rows;
  assert.deepEqual(rows.filter(row => row.slot).map(row => [row.id, row.key]),
    [['combo', '«Удар»'], ['dash', '«Шаг»'], ['wave', '1'], ['palm', '2'], ['crane', '3']]);
  assert.deepEqual(panel.skillsView().slots.map(slot => slot.label), ['«Удар»', '«Шаг»', '1', '2', '3']);
  assert.match(panel.skillsView().detail.kind, /^(серия|техника) · («Удар»|1)$/);
});

test('a tab switch, a panel key or a tap ends a running drop hold, so the redrawn cell never drops (mobile-touch §12)', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { game } = run();
  claimCampSupplies(game, game.player);
  const panel = new MonkPanel({ addEventListener() {} }, { getGame: () => game, doc: { getElementById: () => null } });
  // The controller is open, but MonkPanel draws nothing without a DOM.
  panel.render = () => {};
  panel.content = { contains: () => false };
  const c = panel.controller;
  c.open('gear');
  const [first, second] = game.inventory.bag;
  const ground = game.groundItems.length;
  const wait = () => t.mock.timers.tick(ITEM_RULES.dropHoldTime * 1000);
  // A tap on «Умения» while a finger or □ still holds a bag cell.
  const held = control({ bag: '0' });
  panel.holdDrop(held);
  panel.click({ target: control({ tab: 'skills' }) });
  wait();
  assert.equal(game.inventory.bag[0], first, 'a tab tap ends the hold');
  assert.equal(held.classList.contains('holding'), false);
  // Tab, or L1 / R1 on the pad, switches the tab by key.
  c.show('gear');
  panel.holdDrop(control({ bag: '1' }));
  assert.equal(panel.key({ code: 'Tab', key: 'Tab' }), 'tab');
  wait();
  assert.equal(game.inventory.bag[1], second, 'a tab key ends the hold');
  // ✕ (A) presses the focused cell while □ holds it: the cell equips, and the old weapon in it stays.
  c.show('gear');
  panel.holdDrop(control({ bag: '0' }));
  panel.click({ target: control({ bag: '0' }) });
  wait();
  assert.equal(game.inventory.equipped.weapon, first);
  assert.equal(game.groundItems.length, ground, 'nothing fell to the ground');
});

// Captured touch moves still target the pressed button after leaving its rectangle.
// Keep the real controller, inventory and timer; only the DOM event surface is supplied here.
function dropPointerFixture({ pointerType = 'touch', button = 0 } = {}) {
  const { game } = run();
  claimCampSupplies(game, game.player);
  const root = new EventTarget();
  new MonkPanel(root, { getGame: () => game, doc: { getElementById: () => null } });
  const target = control(pointerType === 'mouse' ? { bag: '0' } : { drop: '0' });
  target.getBoundingClientRect = () => ({ left: 10, right: 90, top: 20, bottom: 64 });
  const send = (type, extra = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }),
      { pointerId: 7, pointerType, button, clientX: 50, clientY: 40, ...extra });
    Object.defineProperty(event, 'target', { value: target });
    root.dispatchEvent(event);
  };
  return { game, target, send, item: game.inventory.bag[0], ground: game.groundItems.length };
}

test('a captured touch drop hold cancels outside every edge and does not restart on re-entry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [clientX, clientY] of [[9, 40], [91, 40], [50, 19], [50, 65]]) {
    const { game, target, send, item, ground } = dropPointerFixture();
    send('pointerdown');
    t.mock.timers.tick(100);
    send('pointermove', { clientX, clientY });
    send('pointermove', { clientX: 50, clientY: 40 });
    t.mock.timers.tick(700);
    assert.equal(game.inventory.bag[0], item, `leaving at ${clientX},${clientY} keeps the item`);
    assert.equal(game.groundItems.length, ground, 'no item falls after cancellation');
    assert.equal(target.classList.contains('holding'), false, 'the hold indicator clears');
  }
});

test('other pointers cannot cancel a touch drop hold that stays inside its button', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { game, send, item, ground } = dropPointerFixture();
  send('pointerdown');
  t.mock.timers.tick(100);
  send('pointermove', { clientX: 30, clientY: 30 });
  for (const type of ['pointermove', 'pointerup', 'pointercancel', 'pointerleave']) {
    send(type, { pointerId: 8, clientX: 0, clientY: 0 });
  }
  t.mock.timers.tick(499);
  assert.equal(game.inventory.bag[0], item, 'inside movement does not drop early');
  t.mock.timers.tick(1);
  assert.equal(game.inventory.bag[0], null, 'the owning finger completes the full hold');
  assert.equal(game.groundItems.length, ground + 1);
});

test('pointercancel from the owning touch cancels its drop hold', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { game, target, send, item, ground } = dropPointerFixture();
  send('pointerdown');
  t.mock.timers.tick(100);
  send('pointercancel');
  t.mock.timers.tick(700);
  assert.equal(game.inventory.bag[0], item);
  assert.equal(game.groundItems.length, ground);
  assert.equal(target.classList.contains('holding'), false);
});

test('mouse RMB keeps its full hold, early release and pointerleave drop behaviour', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const ending of ['full', 'pointerup', 'pointerleave']) {
    const { game, send, item, ground } = dropPointerFixture({ pointerType: 'mouse', button: 2 });
    send('pointerdown');
    t.mock.timers.tick(100);
    send('pointermove', { clientX: 30, clientY: 30 });
    if (ending !== 'full') send(ending);
    t.mock.timers.tick(500);
    assert.equal(game.inventory.bag[0], ending === 'full' ? null : item, ending);
    assert.equal(game.groundItems.length, ground + (ending === 'full' ? 1 : 0), ending);
  }
});

test('another finger still cancels an active mouse drop hold', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    const { game, send, item, ground } = dropPointerFixture({ pointerType: 'mouse', button: 2 });
    send('pointerdown');
    t.mock.timers.tick(100);
    send(type, { pointerId: 8, pointerType: 'touch' });
    t.mock.timers.tick(700);
    assert.equal(game.inventory.bag[0], item, type);
    assert.equal(game.groundItems.length, ground, type);
  }
});
