// Browser persistence is opt-in: the simulation never imports or accesses storage.
import { createOverworld, getOverworldZone } from './overworld.js';
import { isWalkable } from './world.js';
import { MONK_PATH, PROGRESSION_RULES, canSpendPoint, levelForXp } from './progression.js';
import { ITEM_RULES, createItem } from './items.js';
import { SKILLS, SLOTS } from './skills.js';
import { refreshStats } from './run-progress.js';

export const SAVE_KEY = 'ritual-save-v1';
const VERSION = 1;
const copy = value => JSON.parse(JSON.stringify(value));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const strings = value => Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length;

// Only immutable plain data can keep a fingerprint. Mutable/test worlds are re-hashed.
const fingerprints = new WeakMap(), frozenGraphs = new WeakSet();
function frozenData(value, checking = new WeakSet()) {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (frozenGraphs.has(value)) return true;
  if (!Object.isFrozen(value) || checking.has(value)) return false;
  checking.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!('value' in descriptor) || !frozenData(descriptor.value, checking)) return false;
  }
  frozenGraphs.add(value);
  return true;
}

// Hash geometry, authored checkpoints and seeded encounters, without a world-version constant.
export function worldFingerprint(world) {
  const cached = fingerprints.get(world);
  if (cached !== undefined) return cached;
  const layout = JSON.stringify({ tiles: world.tiles, obstacles: world.obstacles, spawn: world.spawn,
    caches: world.caches, shrines: world.shrines, ritual: world.ritual, reward: world.reward,
    zones: world.zones.map(({ id, entries, spawn, regions, area }) => ({ id, entries, spawn, regions, area })),
    encounters: world.encounters });
  let hash = 0x811c9dc5;
  for (let i = 0; i < layout.length; i++) hash = Math.imul(hash ^ layout.charCodeAt(i), 0x01000193);
  const result = (hash >>> 0).toString(16).padStart(8, '0');
  if (frozenData(world)) fingerprints.set(world, result);
  return result;
}

export function setCheckpoint(game, zoneId = 'camp', from = null) {
  const zone = game.world.zones.find(entry => entry.id === zoneId);
  if (!zone) return false;
  const nearest = Object.values(zone.entries ?? {}).sort((a, b) =>
    Math.hypot(a.x - game.player.x, a.y - game.player.y) - Math.hypot(b.x - game.player.x, b.y - game.player.y))[0];
  const at = from === null ? zone.spawn : zone.entries?.[from] ?? nearest ?? zone.spawn;
  if (!at) return false;
  game.checkpoint = { zoneId, x: at.x, y: at.y };
  return true;
}

function saveState(game) {
  return { version: VERSION, fingerprint: worldFingerprint(game.world), savedAt: Date.now(), seed: game.seed,
    progression: game.progression, inventory: game.inventory, loadout: game.loadout, newTechniques: game.newTechniques,
    adventure: game.adventure, shrinesUsed: game.shrinesUsed ?? [], shrineUsed: game.shrineUsed,
    lootClaimed: game.lootClaimed, defeated: game.enemies.filter(enemy => enemy.hp <= 0).map(enemy => enemy.id),
    ritualOpen: game.enemies.some(enemy => enemy.kind === 'ritual' && !enemy.sealed),
    kills: game.kills, time: game.time,
    checkpoint: game.checkpoint ?? { zoneId: 'camp', x: game.world.spawn.x, y: game.world.spawn.y } };
}

export function snapshotRun(game) { return copy(saveState(game)); }

function valid(data, world) {
  if (!record(data) || data.version !== VERSION || !Number.isInteger(data.seed) || data.seed < 0 || data.seed > 0xffffffff
    || !nonnegative(data.savedAt) || data.fingerprint !== worldFingerprint(world)) return false;
  const p = data.progression, inventory = data.inventory, loadout = data.loadout, adventure = data.adventure, cp = data.checkpoint;
  if (!record(p) || !nonnegative(p.xp) || p.xp > PROGRESSION_RULES.levelXp.at(-1) || p.level !== levelForXp(p.xp) || !strings(p.path)) return false;
  const path = { xp: p.xp, level: p.level, path: [] };
  // Validate prerequisites independently of the player's allocation order.
  for (const id of [...p.path].sort((a, b) => (MONK_PATH.nodes.find(n => n.id === a)?.row ?? 99) - (MONK_PATH.nodes.find(n => n.id === b)?.row ?? 99))) {
    if (!canSpendPoint(path, id).ok) return false;
    path.path.push(id);
  }
  if (!record(inventory) || !record(inventory.equipped) || Object.keys(inventory.equipped).some(key => key !== 'weapon') || !Array.isArray(inventory.bag) || inventory.bag.length !== ITEM_RULES.bagSize) return false;
  const held = [...inventory.bag, inventory.equipped.weapon];
  for (const item of held) {
    if (item === null) continue;
    if (!record(item) || typeof item.id !== 'string' || typeof item.source !== 'string' || !Array.isArray(item.affixes)) return false;
    const canonical = createItem({ ...item, affixes: item.affixes.map(affix => affix.id) });
    if (JSON.stringify(canonical) !== JSON.stringify(item)) return false;
  }
  if (new Set(held.filter(Boolean).map(item => item.id)).size !== held.filter(Boolean).length) return false;
  if (!record(loadout) || !record(loadout.slots) || !record(loadout.modifiers)
    || loadout.slots.lmb !== 'combo' || loadout.slots.space !== 'dash') return false;
  const techniques = [];
  for (const slot of SLOTS.filter(slot => slot.accepts === 'technique')) {
    const id = loadout.slots[slot.id];
    if (id === null) continue;
    if (slot.unlockLevel > p.level || SKILLS[id]?.kind !== 'technique' || SKILLS[id].unlockLevel > p.level) return false;
    techniques.push(id);
  }
  if (new Set(techniques).size !== techniques.length) return false;
  for (const [id, modifier] of Object.entries(loadout.modifiers)) {
    const skill = SKILLS[id];
    if (!skill || (modifier !== null && (skill.modifierLevel > p.level || !skill.modifiers.some(m => m.id === modifier)))) return false;
  }
  if (!strings(data.newTechniques) || data.newTechniques.some(id => SKILLS[id]?.kind !== 'technique' || SKILLS[id].unlockLevel > p.level)) return false;
  const zoneIds = world.zones.map(zone => zone.id);
  if (!record(adventure) || !['outbound', 'ritual', 'return'].includes(adventure.quest)
    || typeof adventure.secretFound !== 'boolean' || adventure.rewardCollected !== false
    || !strings(adventure.visited) || adventure.visited.some(id => !zoneIds.includes(id))
    || !Number.isInteger(adventure.totalKills) || !nonnegative(adventure.totalKills) || !nonnegative(adventure.elapsed)
    || !strings(adventure.cachesFound) || adventure.cachesFound.some(id => !world.caches.some(cache => cache.id === id))) return false;
  if (!strings(data.shrinesUsed) || data.shrinesUsed.some(id => !world.shrines.some(shrine => shrine.id === id))
    || typeof data.shrineUsed !== 'boolean' || !strings(data.lootClaimed) || !strings(data.defeated)
    || data.defeated.some(id => id !== 'court-ritual' && !world.encounters.some(enemy => enemy.id === id))
    || typeof data.ritualOpen !== 'boolean' || !Number.isInteger(data.kills) || !nonnegative(data.kills) || !nonnegative(data.time)) return false;
  if (!record(cp) || !zoneIds.includes(cp.zoneId) || !Number.isFinite(cp.x) || !Number.isFinite(cp.y)
    || getOverworldZone(cp.x, cp.y).id !== cp.zoneId || !isWalkable(cp.x, cp.y, .23, world)) return false;
  const zone = world.zones.find(zone => zone.id === cp.zoneId);
  return [zone.spawn, ...Object.values(zone.entries)].some(at => at?.x === cp.x && at?.y === cp.y);
}

export function restoreRun(game, data) {
  try {
    if (game.seed !== data?.seed || !valid(data, game.world)) return false;
    const saved = copy(data);
    for (const field of ['progression', 'inventory', 'loadout', 'newTechniques', 'adventure', 'shrinesUsed', 'shrineUsed', 'lootClaimed', 'kills', 'time', 'checkpoint']) game[field] = saved[field];
    for (const enemy of game.enemies) {
      if (saved.defeated.includes(enemy.id)) Object.assign(enemy, { hp: 0, state: 'dead', active: false, returning: false, sealed: false });
      else if (enemy.kind === 'ritual' && saved.ritualOpen) Object.assign(enemy, { sealed: false, state: 'idle' });
    }
    game.phase = 'playing'; game.locationId = saved.checkpoint.zoneId;
    game.locationRevision++;
    game.groundItems = []; game.pickups = []; game.projectiles = []; game.monkShots = []; game.events = []; game.effects = [];
    Object.assign(game.player, { x: saved.checkpoint.x, y: saved.checkpoint.y, attack: null, technique: null, dashTime: 0,
      dashCooldown: 0, waveCooldown: 0, cooldowns: {}, combo: 0, comboTimer: 0, lockout: 0, invulnerable: 0, hitFlash: 0, moving: false });
    refreshStats(game);
    game.player.hp = game.player.maxHp; game.player.spirit = game.player.maxSpirit;
    return true;
  } catch { return false; }
}

export function clearSave(storage) {
  try { storage.removeItem(SAVE_KEY); return true; } catch { return false; }
}

export function readSave(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    if (!record(data) || !Number.isInteger(data.seed) || !valid(data, createOverworld(data.seed))) {
      clearSave(storage); return null;
    }
    return data;
  } catch { clearSave(storage); return null; }
}

export function writeSave(storage, game) {
  try {
    if (!game.adventure || game.phase !== 'playing' || game.adventure.rewardCollected) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(saveState(game)));
    return true;
  } catch { return false; }
}

// Browser lifecycle coordinator. Call flush from the frame loop and after a hidden-page delay.
// All dependencies are explicit, so tests and simulations never use window.localStorage.
export function createRunAutosave({ getGame, getMode, getStorage, now = Date.now, onZoneSaved = () => {} }) {
  let pending = false, zoneNotice = false, lastWrite = -Infinity, cleared = null;
  const active = () => getMode() !== 'welcome' && getGame().phase === 'playing';
  function flush() {
    if (!active()) { pending = false; zoneNotice = false; return false; }
    if (!pending || now() - lastWrite < 1000) return false;
    pending = false;
    let saved = false;
    try { saved = writeSave(getStorage(), getGame()); } catch { /* Storage getter can be denied too. */ }
    // Failed storage is not retried each frame; the next gameplay/lifecycle event can retry it.
    lastWrite = now();
    if (saved && zoneNotice) onZoneSaved();
    zoneNotice = false;
    return saved;
  }
  function request(zone = false) {
    if (!active()) return false;
    pending = true; zoneNotice ||= zone;
    return flush();
  }
  return {
    request, flush,
    // Warm immutable geometry while the loading screen is still up; never access storage here.
    prepare() { try { worldFingerprint(getGame().world); } catch { /* Saving remains optional. */ } },
    start() {
      if (!active()) return;
      pending = false; zoneNotice = false; cleared = null;
      if (!getGame().checkpoint) setCheckpoint(getGame());
      request();
    },
    events(events) {
      const game = getGame();
      if (game.phase === 'victory' && game.adventure.rewardCollected) {
        pending = false; zoneNotice = false;
        if (cleared !== game) { try { clearSave(getStorage()); } catch { /* Denied storage getter. */ } cleared = game; }
        return;
      }
      if (!active()) { pending = false; zoneNotice = false; return; }
      let changed = false, zone = false;
      for (const event of events) {
        if (event.type === 'area-enter') { setCheckpoint(game, event.to, event.from); zone = true; }
        if (['level-up', 'loot-pickup', 'secret', 'xp', 'death', 'pack-cleared', 'ritual-open', 'ritual-destroyed',
          'heal', 'equip', 'path', 'loadout', 'loot-drop'].includes(event.type)) changed = true;
      }
      if (zone || changed) request(zone);
    },
  };
}
