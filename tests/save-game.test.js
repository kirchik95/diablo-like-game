import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, updateGame, startWave } from '../src/game.js';
import { gainXp, spendPathPoint, chooseSkillModifier } from '../src/run-progress.js';
import { claimCampSupplies, equipItem } from '../src/inventory-actions.js';
import { PROGRESSION_RULES } from '../src/progression.js';
import * as saves from '../src/save-game.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const json = value => JSON.parse(JSON.stringify(value));
function progressed() {
  const game = createAdventure({}, { seed: 777 });
  gainXp(game, PROGRESSION_RULES.levelXp[3]);
  spendPathPoint(game, 'tempering');
  chooseSkillModifier(game, 'wave', 'heavyWave');
  claimCampSupplies(game, game.player); equipItem(game, 0);
  Object.assign(game.adventure, { quest: 'ritual', secretFound: true, cachesFound: ['secret'], totalKills: 2, elapsed: 125.5, visited: ['camp', 'road', 'courtyard'] });
  game.lootClaimed.push('secret'); game.shrinesUsed = ['road-shrine']; game.shrineUsed = true;
  game.kills = 2; game.time = 126;
  for (const enemy of game.enemies.slice(0, 2)) { enemy.hp = 0; enemy.state = 'dead'; }
  saves.setCheckpoint(game, 'road', 'camp');
  Object.assign(game.player, { x: 1, y: -49, hp: 1, spirit: 0 });
  game.groundItems.push({ id: 'unsaved-ground-item' });
  return game;
}

test('snapshot survives JSON and restores progression, gear, loadout, quest and result counters', () => {
  const source = progressed(), data = json(saves.snapshotRun(source));
  assert.equal(data.version, 1); assert.equal(typeof data.savedAt, 'number');
  const target = createAdventure({}, { seed: 777 });
  assert.equal(saves.restoreRun(target, data), true);
  for (const field of ['progression', 'inventory', 'loadout', 'adventure', 'lootClaimed', 'shrinesUsed', 'shrineUsed', 'kills', 'time', 'newTechniques']) assert.deepEqual(target[field], source[field], field);
  assert.equal(target.locationId, 'road');
  assert.deepEqual({ x: target.player.x, y: target.player.y }, source.world.zones.find(z => z.id === 'road').entries.camp);
  assert.equal(target.player.hp, target.player.maxHp); assert.equal(target.player.spirit, target.player.maxSpirit);
  assert.equal(target.groundItems.length, 0);
  assert.ok(!JSON.stringify(data).includes('unsaved-ground-item'));
  target.progression.path.push('deep-breath'); assert.deepEqual(data.progression.path, ['tempering']);
});

test('defeated encounters and cleared packs cannot respawn or award loot twice', () => {
  const source = createAdventure({}, { seed: 777 });
  const pack = source.enemies[0].packId;
  for (const enemy of source.enemies.filter(e => e.packId === pack)) { enemy.hp = 0; enemy.state = 'dead'; }
  source.lootClaimed.push(pack);
  const target = createAdventure({}, { seed: 777 });
  assert.equal(saves.restoreRun(target, json(saves.snapshotRun(source))), true);
  const dead = target.enemies.filter(e => e.packId === pack);
  Object.assign(target.player, { x: dead[0].x, y: dead[0].y });
  startWave(target); updateGame(target, {}, 1 / 120);
  assert.ok(dead.every(e => e.hp === 0 && e.state === 'dead'));
  assert.equal(target.kills, 0); assert.equal(target.progression.xp, 0);
  assert.equal(target.groundItems.length, 0);
  assert.equal(target._locations.road.kills, dead.length);
});

test('fingerprint covers tiles, zone entries and seeded encounter definitions', () => {
  const world = createAdventure({}, { seed: 777 }).world;
  const hash = saves.worldFingerprint(world);
  assert.equal(saves.worldFingerprint(json(world)), hash);
  for (const mutate of [w => w.tiles.pop(), w => w.zones[1].entries.camp.x++, w => w.encounters[0].x++, w => w.encounters[0].id += '-changed']) {
    const changed = json(world); mutate(changed); assert.notEqual(saves.worldFingerprint(changed), hash);
  }
});

test('read drops wrong versions, fingerprints, malformed JSON and invalid state without mutating a run', () => {
  const game = progressed(), valid = json(saves.snapshotRun(game));
  for (const mutate of [d => d.version++, d => d.fingerprint = 'obsolete', d => d.progression.path.push('missing'), d => d.checkpoint.x = 99999,
    d => d.loadout.slots.rmb = 'missing', d => d.inventory.bag = [], d => d.defeated.push('missing'), d => d.adventure = null]) {
    const data = json(valid); mutate(data); const store = storage(); store.setItem('ritual-save-v1', JSON.stringify(data));
    assert.equal(saves.readSave(store), null);
    const target = createAdventure({}, { seed: 777 }), before = json(target);
    assert.equal(saves.restoreRun(target, data), false); assert.deepEqual(json(target), before);
    assert.equal(store.getItem('ritual-save-v1'), null);
  }
  const store = storage(); store.setItem('ritual-save-v1', '{broken'); assert.equal(saves.readSave(store), null);
});

test('fake storage roundtrip and clear never access browser storage implicitly', () => {
  const game = progressed(), store = storage();
  assert.equal(saves.writeSave(store, game), true);
  const saved = saves.readSave(store); assert.equal(saved.seed, 777); assert.equal(saved.progression.level, 4);
  assert.equal(saves.clearSave(store), true); assert.equal(saves.readSave(store), null);
});

test('throwing or absent storage is harmless, including storage property getters', () => {
  const broken = { getItem() { throw Error('private'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('private'); } };
  const getters = Object.defineProperties({}, Object.fromEntries(['getItem','setItem','removeItem'].map(key => [key, { get() { throw Error('private'); } }])));
  for (const store of [broken, getters, null, undefined]) {
    assert.equal(saves.readSave(store), null);
    assert.equal(saves.writeSave(store, createAdventure()), false);
    assert.equal(saves.clearSave(store), false);
  }
});

test('checkpoint positions are authored zone entries rather than mid-fight positions', () => {
  const game = createAdventure();
  assert.deepEqual(saves.snapshotRun(game).checkpoint, { zoneId: 'camp', ...game.world.spawn });
  Object.assign(game.player, { x: 10, y: -42 });
  saves.setCheckpoint(game, 'cemetery', 'road');
  assert.deepEqual(saves.snapshotRun(game).checkpoint, { zoneId: 'cemetery', ...game.world.zones.find(z => z.id === 'cemetery').entries.road });
});

test('autosave batches writes to one per second, saves zone checkpoints and skips welcome and defeat', () => {
  const store = storage(), game = createAdventure({}, { seed: 777 });
  let mode = 'welcome', now = 0, noticeCount = 0;
  const autosave = saves.createRunAutosave({ getGame: () => game, getMode: () => mode, getStorage: () => store,
    now: () => now, onZoneSaved: () => noticeCount++ });
  autosave.start(); assert.equal(saves.readSave(store), null);
  mode = 'playing'; autosave.start();
  assert.equal(saves.readSave(store).checkpoint.zoneId, 'camp');
  now = 100; gainXp(game, 5); autosave.events([{ type: 'loot-pickup' }]);
  assert.equal(saves.readSave(store).progression.xp, 0);
  now = 400; autosave.events([{ type: 'area-enter', from: 'camp', to: 'road' }]);
  assert.equal(noticeCount, 0);
  now = 1000; autosave.flush();
  assert.equal(saves.readSave(store).progression.xp, 5);
  assert.equal(saves.readSave(store).checkpoint.zoneId, 'road'); assert.equal(noticeCount, 1);
  now = 2100; gainXp(game, 5); autosave.events([{ type: 'path' }]); autosave.flush();
  assert.equal(saves.readSave(store).progression.xp, 10);
  mode = 'defeat'; game.phase = 'defeat'; now = 4000;
  autosave.request(); autosave.flush(); assert.equal(saves.readSave(store).progression.xp, 10);
});

test('victory clears the slot, hidden-page requests keep latest progress and storage getter denial is harmless', () => {
  const game = createAdventure(), store = storage(); let now = 0;
  const autosave = saves.createRunAutosave({ getGame: () => game, getMode: () => 'playing', getStorage: () => store, now: () => now });
  autosave.start(); now = 1000; gainXp(game, 5); autosave.request();
  assert.equal(saves.readSave(store).progression.xp, 5);
  game.phase = 'victory'; game.adventure.rewardCollected = true; autosave.events([]);
  assert.equal(saves.readSave(store), null);
  const denied = saves.createRunAutosave({ getGame: () => game, getMode: () => 'playing', getStorage() { throw Error('private'); } });
  assert.doesNotThrow(() => { denied.start(); denied.request(); denied.events([]); denied.flush(); });
});

test('corrupt extra equipment is ignored before restore can mutate any state', () => {
  const source = progressed(), data = json(saves.snapshotRun(source));
  data.inventory.equipped.beob = { affixes: {} };
  const target = createAdventure({}, { seed: 777 }), before = json(target);
  assert.equal(saves.restoreRun(target, data), false); assert.deepEqual(json(target), before);
  const store = storage(); store.setItem('ritual-save-v1', JSON.stringify(data)); assert.equal(saves.readSave(store), null);
});

test('a destroyed ritual stays destroyed on the return quest without repeating its reward', () => {
  const source = createAdventure({}, { seed: 777 });
  const ritual = source.enemies.find(enemy => enemy.kind === 'ritual');
  Object.assign(ritual, { hp: 0, sealed: false, state: 'dead' }); source.adventure.quest = 'return';
  source.lootClaimed.push('court-ritual');
  const target = createAdventure({}, { seed: 777 });
  assert.equal(saves.restoreRun(target, json(saves.snapshotRun(source))), true);
  updateGame(target, {}, 1 / 120);
  assert.equal(target.enemies.find(enemy => enemy.kind === 'ritual').hp, 0);
  assert.equal(target.adventure.quest, 'return'); assert.equal(target.groundItems.length, 0);
  assert.equal(target.events.some(event => event.type === 'ritual-destroyed'), false);
});


test('a frozen outer world with mutable geometry still re-hashes after a change', () => {
  const world = json(createAdventure({}, { seed: 777 }).world);
  Object.freeze(world.tiles); Object.freeze(world);
  const before = saves.worldFingerprint(world);
  world.tiles[0].x += 1;
  assert.notEqual(saves.worldFingerprint(world), before);
});

test('autosave preparation warms metadata without writing or reading storage in welcome', () => {
  const game = createAdventure({}, { seed: 777 }); let storageReads = 0;
  const autosave = saves.createRunAutosave({ getGame: () => game, getMode: () => 'welcome',
    getStorage: () => { storageReads++; throw Error('unavailable'); } });
  const before = json(game);
  autosave.prepare(); autosave.prepare();
  assert.equal(storageReads, 0);
  assert.deepEqual(json(game), before);
});


test('unserialized cyclic metadata does not prevent fingerprinting an otherwise frozen world', () => {
  const source = createAdventure({}, { seed: 777 }).world;
  const extra = {}; extra.self = extra; Object.freeze(extra);
  const world = Object.freeze({ ...source, extra });
  assert.equal(saves.worldFingerprint(world), saves.worldFingerprint(source));
});


test('non-enumerable geometry accessors and mutable toJSON closures cannot enter the fingerprint cache', () => {
  const source = createAdventure({}, { seed: 777 }).world;
  let tiles = source.tiles;
  const world = { ...source };
  Object.defineProperty(world, 'tiles', { get: () => tiles, enumerable: false });
  Object.freeze(world);
  const before = saves.worldFingerprint(world);
  tiles = [...tiles, { x: 12345, y: 12345 }];
  assert.notEqual(saves.worldFingerprint(world), before);

  let x = 0;
  const point = {};
  Object.defineProperty(point, 'toJSON', { value: () => ({ x, y: 0 }) });
  Object.freeze(point);
  const withJSON = Object.freeze({ ...source, spawn: point });
  const first = saves.worldFingerprint(withJSON);
  x = 1;
  assert.notEqual(saves.worldFingerprint(withJSON), first);
});
