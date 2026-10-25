// Opt-in sustained-fight fixture for ?perf=1&crowd=20|40|60. Never used by a normal run.
import { createAdventure, startWave } from '../src/game.js';
import { isWalkable, clearLine } from '../src/world.js';
export function stressCount(search) {
  const query = new URLSearchParams(search), count = Number(query.get('crowd'));
  return query.get('perf') === '1' && [20, 40, 60].includes(count) ? count : 0;
}

export function crowdFixture(count) {
  const game = createAdventure({}, { seed: 7 });
  const templates = ['hound', 'wraith', 'beetle'].map(kind => game.enemies.find(e => e.kind === kind));
  const centre = game.world.tiles.find(p => Math.abs(p.x) < 3 && p.y < -35 && p.y > -48 && isWalkable(p.x, p.y, 1, game.world));
  if (!centre) throw new Error('No open stress centre');
  Object.assign(game.player, { x: centre.x, y: centre.y, invulnerable: 1e6 });
  game.enemies = Array.from({ length: count }, (_, i) => {
    const template = templates[i % 3], angle = i * 2.399963229728653, radius = 1.5 + 3 * Math.sqrt((i + .5) / count);
    let x = centre.x + Math.cos(angle) * radius, y = centre.y + Math.sin(angle) * radius;
    if (!isWalkable(x, y, template.radius, game.world) || !clearLine(centre, {x,y}, template.radius, game.world)) { x = centre.x; y = centre.y; }
    return { ...template, id: `stress-${i}`, x, y, homeX: x, homeY: y, packId: 'stress', active: true, returning: false,
      hp: 1e6, maxHp: 1e6, state: 'chase', timer: 0, attackCooldown: i * .07, path: [], repath: 0 };
  });
  return game;
}
export function crowdControls(game) {
  const angle = game.time * .7;
  // Keep all actors alive while exercising combat events, hit masks, audio and HUD.
  if (game.time >= (game._stressWave ?? 2)) { startWave(game); game._stressWave = game.time + 3; }
  return { moveX: 0, moveY: 0, aimX: Math.cos(angle), aimY: Math.sin(angle), attack: true, actions: [] };
}
