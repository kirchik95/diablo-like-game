import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboarding, onboardingState } from '../src/onboarding.js';
import { controlKeys } from '../src/gamepad.js';
import { createAdventure } from '../src/game.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const state = (extra = {}) => ({ started: true, visible: true, now: 0, distance: 0, nearestMonster: Infinity,
  hits: 0, dashes: 0, techniques: 0, techniqueReady: false, groundItems: 0, pickups: 0,
  levelUps: 0, points: 0, panelOpen: false, nearSite: null, sitesUsed: 0, packsCleared: 0,
  inputMode: 'keyboard', keys: controlKeys(), ...extra });
function throughMovement(machine) {
  assert.equal(machine.observe(state()).id, 'welcome');
  machine.done('welcome');
  assert.equal(machine.observe(state()).id, 'move');
  assert.equal(machine.observe(state({ distance: 3 })), null);
}
function throughCombat(machine) {
  throughMovement(machine);
  assert.equal(machine.observe(state({ nearestMonster: 8 })).id, 'attack');
  assert.equal(machine.observe(state({ hits: 1 })).id, 'dash');
  assert.equal(machine.observe(state({ hits: 1, dashes: 1, techniqueReady: true })).id, 'technique');
  assert.equal(machine.observe(state({ hits: 1, dashes: 1, techniques: 1 })), null);
}

test('nothing shows before a run starts, and welcome alone pauses without timing out', () => {
  const machine = createOnboarding(storage());
  assert.equal(machine.observe({ started: false }), null);
  const welcome = machine.observe(state());
  assert.equal(welcome.id, 'welcome');
  assert.equal(welcome.pause, true);
  assert.equal(machine.observe(state({ now: 100 })).id, 'welcome');
});

test('movement waits for welcome and completes at three walked units', () => {
  const machine = createOnboarding(storage());
  machine.observe(state()); machine.done('move');
  assert.equal(machine.observe(state()).id, 'welcome', 'unshown steps cannot be completed');
  machine.done('welcome');
  assert.equal(machine.observe(state({ distance: 2.99 })).id, 'move');
  assert.equal(machine.observe(state({ distance: 3 })), null);
});

test('combat hints wait for a nearby monster, first hit, dash and affordable technique', () => {
  const machine = createOnboarding(storage());
  throughMovement(machine);
  assert.equal(machine.observe(state({ nearestMonster: 8.01 })), null);
  assert.equal(machine.observe(state({ nearestMonster: 8 })).id, 'attack');
  assert.equal(machine.observe(state({ hits: 1 })).id, 'dash');
  assert.equal(machine.observe(state({ hits: 1, dashes: 1 })), null);
  assert.equal(machine.observe(state({ hits: 1, dashes: 1, techniqueReady: true })).id, 'technique');
  assert.equal(machine.observe(state({ techniques: 1 })), null);
});

test('each nonblocking card expires eight seconds after it is first displayed', () => {
  const machine = createOnboarding(storage());
  machine.observe(state()); machine.done('welcome');
  assert.equal(machine.observe(state({ now: 10 })).id, 'move');
  assert.equal(machine.observe(state({ now: 17.99 })).id, 'move');
  assert.equal(machine.observe(state({ now: 18 })), null);
  assert.equal(machine.observe(state({ now: 50, nearestMonster: 7 })).id, 'attack');
});

test('contextual cards keep order when all are eligible and complete on their own actions', () => {
  const machine = createOnboarding(storage()); throughCombat(machine);
  const context = { groundItems: 1, levelUps: 1, points: 1, nearSite: 'cache', packsCleared: 1 };
  assert.equal(machine.observe(state(context)).id, 'pickup');
  assert.equal(machine.observe(state({ ...context, pickups: 1 })).id, 'points');
  assert.equal(machine.observe(state({ ...context, panelOpen: true })).id, 'site');
  assert.equal(machine.observe(state({ ...context, sitesUsed: 1 })).id, 'orientation');
  assert.equal(machine.observe(state({ ...context, now: 8 })), null);
  assert.equal(machine.observe(state(context)), null, 'completed steps never repeat');
});

test('an unavailable loot or level hint does not block the first-pack map hint', () => {
  const machine = createOnboarding(storage()); throughCombat(machine);
  assert.equal(machine.observe(state({ packsCleared: 1 })).id, 'orientation');
  machine.done('orientation');
  assert.equal(machine.observe(state({ levelUps: 1, points: 0 })), null);
  assert.equal(machine.observe(state({ levelUps: 1, points: 1 })).id, 'points');
});

test('skipping persists once-only status across instances and reset enables welcome again', () => {
  const memory = storage(), machine = createOnboarding(memory);
  machine.observe(state()); machine.skip();
  assert.equal(machine.observe(state()), null);
  const reloaded = createOnboarding(memory);
  assert.equal(reloaded.observe(state()), null);
  reloaded.reset();
  assert.equal(memory.getItem('ritual-onboarding-v1'), null);
  assert.equal(reloaded.observe(state()).id, 'welcome');
});

test('finishing every step persists completion across page loads', () => {
  const memory = storage(), machine = createOnboarding(memory); throughCombat(machine);
  for (const [id, trigger] of [['pickup', { groundItems: 1 }], ['points', { levelUps: 1, points: 1 }],
    ['site', { nearSite: 'shrine' }], ['orientation', { packsCleared: 1 }]]) {
    assert.equal(machine.observe(state(trigger)).id, id); machine.done(id);
  }
  assert.equal(createOnboarding(memory).observe(state()), null);
});

test('partial progress resumes without repeating welcome or movement', () => {
  const memory = storage(), machine = createOnboarding(memory); throughMovement(machine);
  const reloaded = createOnboarding(memory);
  assert.equal(reloaded.observe(state()), null);
  assert.equal(reloaded.observe(state({ nearestMonster: 2 })).id, 'attack');
});

test('a restored save never shows onboarding or writes completion', () => {
  const memory = storage(), machine = createOnboarding(memory);
  assert.equal(machine.observe(state({ restored: true })), null);
  assert.equal(memory.getItem('ritual-onboarding-v1'), null);
});

test('denied storage still allows one tutorial per page and replay', () => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); }, removeItem() { throw Error('denied'); } };
  const machine = createOnboarding(denied);
  assert.equal(machine.observe(state()).id, 'welcome');
  machine.skip();
  assert.equal(machine.observe(state()), null);
  machine.reset();
  assert.equal(machine.observe(state()).id, 'welcome');
});

test('malformed saved progress is ignored safely', () => {
  for (const value of ['{bad', 'null', '42', '{"version":99,"finished":true}', '{"version":1,"completed":"move"}']) {
    const machine = createOnboarding({ getItem: () => value });
    assert.equal(machine.observe(state()).id, 'welcome');
  }
});

test('glyphs follow current bindings and switch while a card is shown', () => {
  const machine = createOnboarding(storage()); machine.observe(state()); machine.done('welcome');
  assert.equal(machine.observe(state({ keys: { ...controlKeys(), move: 'ESDF' } })).glyph, 'ESDF');
  const touch = machine.observe(state({ inputMode: 'touch', keys: controlKeys('touch') }));
  assert.equal(touch.glyph, 'Джойстик');
  machine.done('move'); machine.observe(state({ nearestMonster: 2 })); machine.done('attack');
  const pad = machine.observe(state({ hits: 1, inputMode: 'pad', keys: controlKeys('playstation') }));
  assert.equal(pad.glyph, '✕');
});

test('hidden panels do not show a hint or acknowledge it', () => {
  const machine = createOnboarding(storage()); machine.observe(state()); machine.done('welcome');
  assert.equal(machine.observe(state()).id, 'move');
  assert.equal(machine.observe(state({ visible: false, distance: 5 })), null);
  assert.equal(machine.observe(state()).id, 'move');
});

test('game observations use real events and distances without changing simulation state', () => {
  const game = createAdventure({}, { seed: 1 });
  const session = { distance: game.player.distance, hits: 0, dashes: 0, techniques: 0, pickups: 0,
    levelUps: 0, sitesUsed: 0, packsCleared: 0 };
  game.events.push({ type: 'impact', source: 'combo' }, { type: 'dash' }, { type: 'wave' },
    { type: 'loot-pickup', source: 'camp-supplies' }, { type: 'loot-pickup', source: 'pack' },
    { type: 'pack-cleared' }, { type: 'level-up' }, { type: 'secret' });
  const before = JSON.stringify(game);
  const observed = onboardingState(game, session);
  assert.equal(observed.hits, 1); assert.equal(observed.dashes, 1); assert.equal(observed.techniques, 1);
  assert.equal(observed.pickups, 1); assert.equal(observed.levelUps, 1);
  assert.equal(observed.sitesUsed, 1); assert.equal(observed.packsCleared, 1);
  assert.equal(observed.distance, 0);
  assert.equal(JSON.stringify(game), before);
});


test('an item picked up in its drop frame still triggers the pickup lesson', () => {
  const machine = createOnboarding(storage()); throughCombat(machine);
  assert.equal(machine.observe(state({ groundItems: 0, pickups: 1 })).id, 'pickup');
  assert.equal(machine.observe(state({ pickups: 1 })), null);
});
