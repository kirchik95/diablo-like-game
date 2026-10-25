// Loot in game state (§3.5–3.7): site drops, items on the ground, the bag and the weapon slot.
// game.groundItems holds { id, item, x, y, source, rearm }. rearm keeps an item on the ground
// until the monk leaves its pickup radius: after a full-bag refusal or after he drops it.
import { emit } from './game-events.js';
import { ITEM_RULES, dropFromBag, equipFromBag, lootForSite, pickUpItem, unequipWeapon } from './items.js';
import { clearLine, isWalkable } from './world.js';
import { refreshStats } from './run-progress.js';

function placeOnGround(game, item, at, source, rearm = false) {
  const ground = { id: item.id, item, x: at.x, y: at.y, source, rearm };
  (game.groundItems ??= []).push(ground);
  emit(game, 'loot-drop', at.x, at.y, { id: item.id, item, source });
  return ground;
}

// Drops a site's run loot once (packs, the cache, the ritual source) at a world point.
export function dropSiteLoot(game, siteId, at) {
  if (!game.loot || game.lootClaimed.includes(siteId)) return [];
  game.lootClaimed.push(siteId);
  const items = lootForSite(game.loot, siteId, game.inventory.equipped.weapon?.family);
  for (const item of items) placeOnGround(game, item, at, siteId);
  return items;
}

// Camp supplies (E) put both common weapons straight into the bag; a full bag leaves them here.
export function claimCampSupplies(game, at) {
  if (!game.loot || game.lootClaimed.includes('camp-supplies')) return false;
  game.lootClaimed.push('camp-supplies');
  const items = lootForSite(game.loot, 'camp-supplies');
  for (const item of items) {
    const result = pickUpItem(game.inventory, item);
    if (result.ok) emit(game, 'loot-pickup', at.x, at.y, { id: item.id, item, slot: result.slot, source: 'camp-supplies' });
    else {
      placeOnGround(game, item, at, 'camp-supplies', true);
      if (result.reason === 'bag-full') emit(game, 'bag-full', at.x, at.y, { id: item.id, item, notice: ITEM_RULES.bagFullNotice });
    }
  }
  emit(game, 'supplies', at.x, at.y, { count: items.length });
  return true;
}

// The monk walks over an item and it goes into the bag, like a health pickup (§3.6).
export function collectGroundItems(game) {
  if (!game.groundItems?.length || !game.inventory) return;
  const p = game.player;
  game.groundItems = game.groundItems.filter(ground => {
    if (Math.hypot(ground.x - p.x, ground.y - p.y) > ITEM_RULES.pickupRadius || !clearLine(p, ground, .05, game.world)) {
      ground.rearm = false;
      return true;
    }
    if (ground.rearm) return true;
    const result = pickUpItem(game.inventory, ground.item);
    if (result.ok) {
      emit(game, 'loot-pickup', ground.x, ground.y, { id: ground.id, item: ground.item, slot: result.slot, source: ground.source });
      return false;
    }
    if (result.reason !== 'bag-full') return false;
    ground.rearm = true;
    emit(game, 'bag-full', ground.x, ground.y, { id: ground.id, item: ground.item, notice: ITEM_RULES.bagFullNotice });
    return true;
  });
}

const canChangeGear = game => game.phase === 'playing' && !!game.inventory;
// A new weapon starts its own series from the first strike; a swing in progress finishes as it began.
function changedWeapon(game, item, previous, slot) {
  const p = game.player;
  p.combo = 0; p.comboTimer = 0;
  refreshStats(game);
  emit(game, 'equip', p.x, p.y, { item, previous, slot });
}

// Bag actions for the «Снаряжение» panel. Each returns the items.js result.
export function equipItem(game, slot) {
  if (!canChangeGear(game)) return { ok: false, reason: 'phase' };
  const result = equipFromBag(game.inventory, slot);
  if (result.ok) changedWeapon(game, result.item, result.previous, slot);
  return result;
}

export function unequipItem(game) {
  if (!canChangeGear(game)) return { ok: false, reason: 'phase' };
  const previous = game.inventory.equipped.weapon, result = unequipWeapon(game.inventory);
  if (result.ok) changedWeapon(game, null, previous, result.slot);
  return result;
}

// The item lands next to the monk, ahead of him when that ground is free, and can be picked up again.
export function dropItem(game, slot) {
  if (!canChangeGear(game)) return { ok: false, reason: 'phase' };
  const result = dropFromBag(game.inventory, slot);
  if (!result.ok) return result;
  const p = game.player, ahead = { x: p.x + p.dx * .5, y: p.y + p.dy * .5 };
  const at = game.world && isWalkable(ahead.x, ahead.y, .1, game.world) && clearLine(p, ahead, .05, game.world) ? ahead : { x: p.x, y: p.y };
  placeOnGround(game, result.item, at, 'bag', true);
  return result;
}
