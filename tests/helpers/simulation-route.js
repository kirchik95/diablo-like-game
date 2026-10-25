import { createHash } from 'node:crypto';

export const ROUTE_SEEDS = [5, 777, 20261023];
export const STEP = 1 / 120;
export const BUSY_SITES = ['road-crossing', 'court-entrance', 'court-source'];

const side = e => e.zoneId === 'cemetery' || e.zoneId === 'orchard';
const MAIN_PACKS = ['road-approach', 'road-thicket', 'road-crossing', 'road-gate', 'court-entrance', 'court-source'];

// Like run-integration.test.js, relocate to each encounter and finish survivors
// with a real wave. The intervening fixed steps exercise actual steering/combat.
// This is a full-clear regression fixture, not a player balance/playthrough test.
// The main route keeps to the road and the courtyard; with `full`, it also clears the side zones'
// packs, caches, shrine and wanderers. prepare(game) may change the new game before the route.
// view: what a checkpoint covers. view.enemy(e) keeps an enemy; view.event(e) (for events and the
// effects drawn from them) and view.adventure(a) return a copy without fields the checkpoint ignores.
export function runSimulationRoute(api, seed, { full = false, prepare, view = {} } = {}) {
  const { createAdventure, updateGame, startWave, interact, useSlot } = api;
  const { enemy: shown = () => true, event: shownEvent = e => e, adventure: shownAdventure = a => a } = view;
  const game = createAdventure({}, { seed });
  prepare?.(game);
  const checkpoints = [], eventHash = createHash('sha256');
  let steps = 0, events = 0;
  const tick = (input = {}) => {
    updateGame(game, input, STEP);
    eventHash.update(JSON.stringify(game.events.map(shownEvent)));
    events += game.events.length;
    game.events.length = 0;
    if (++steps % 60 === 0) {
      checkpoints.push(createHash('sha256').update(JSON.stringify({
        player: game.player, enemies: game.enemies.filter(shown), projectiles: game.projectiles,
        shots: game.monkShots, effects: game.effects.map(shownEvent), pickups: game.pickups,
        ground: game.groundItems, progression: game.progression, inventory: game.inventory,
        adventure: shownAdventure(game.adventure), phase: game.phase, events: eventHash.copy().digest('hex'),
      })).digest('hex'));
    }
  };
  const settle = (count, input = {}) => { for (let i = 0; i < count; i++) tick(input); };
  const kill = enemy => {
    if (enemy.hp <= 0) return;
    enemy.hp = 1;
    Object.assign(game.player, { x: enemy.x, y: enemy.y, spirit: game.player.maxSpirit,
      waveCooldown: 0, attack: null, dashTime: 0, technique: null, invulnerable: 10000 });
    if (!startWave(game)) throw new Error(`Unable to finish ${enemy.id}`);
    tick();
  };
  // Supplies, six packs, cache/shrine, every wanderer, source, and camp reward.
  Object.assign(game.player, { x: 1, y: 2.5, invulnerable: 10000 });
  const camp = game.world.zones.find(z => z.id === 'camp');
  const { CAMP_SUPPLIES } = api;
  Object.assign(game.player, { x: CAMP_SUPPLIES.x + camp.offset.x, y: CAMP_SUPPLIES.y + camp.offset.y });
  interact(game); settle(120);
  const sidePacks = full ? [...new Set(game.enemies.filter(e => side(e) && !e.wander).map(e => e.packId))] : [];
  for (const packId of [...MAIN_PACKS, ...sidePacks]) {
    const members = game.enemies.filter(e => e.packId === packId);
    Object.assign(game.player, { x: members[0].homeX + 1, y: members[0].homeY, invulnerable: 10000 });
    for (let i = 0; i < 360; i++) {
      const target = members.find(e => e.hp > 0) ?? members[0];
      const aimX = target.x - game.player.x, aimY = target.y - game.player.y;
      if (i % 120 === 0) useSlot(game, 'space', aimX, aimY);
      if (i % 90 === 0) useSlot(game, 'q', aimX, aimY);
      tick({ moveX: i < 180 ? .15 : -.15, moveY: .05, aimX, aimY, attack: true });
    }
    for (const enemy of members) kill(enemy);
    settle(120);
  }
  for (const { x, y } of full ? game.world.caches : [game.world.secret]) { Object.assign(game.player, { x, y }); interact(game); settle(120); }
  for (const { x, y } of full ? game.world.shrines : [game.world.shrine]) { Object.assign(game.player, { x, y }); game.player.hp -= 10; settle(120); }
  for (const enemy of game.enemies.filter(e => e.wander && (full || !side(e)))) {
    Object.assign(game.player, { x: enemy.x + 1, y: enemy.y });
    settle(60, { aimX: -1, aimY: 0, attack: true }); kill(enemy);
  }
  settle(120);
  kill(game.enemies.find(e => e.kind === 'ritual')); settle(120);
  Object.assign(game.player, game.world.reward); tick(); interact(game);
  // Capture the terminal reward events even if the route ends between checkpoints.
  while (steps % 60 !== 0) tick();
  const counted = game.enemies.filter(e => e.kind !== 'ritual' && shown(e) && (full || !side(e)));
  return { seed, steps, events, checkpoints, phase: game.phase, quest: game.adventure.quest,
    kills: game.adventure.totalKills, monsters: counted.length, wanderers: counted.filter(e => e.wander).length };
}
