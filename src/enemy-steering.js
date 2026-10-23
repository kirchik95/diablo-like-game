import { clearLine } from './world.js';
import { WRAITH_STATS } from './campaign.js';

// Stable identity-derived choices, never random samples during simulation.
function fraction(key) {
  let value = 2166136261;
  for (const char of String(key)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

export function approachTarget(enemy, player, world) {
  const x = player.x - enemy.x, y = player.y - enemy.y, distance = Math.hypot(x, y);
  if (distance < 2.15) return player;
  const choice = fraction(enemy.id), side = choice < .5 ? -1 : 1;
  const offset = side * (.7 + fraction(`${enemy.id}:width`) * .65)
    * Math.min(1, (distance - 2.15) / 2.5);
  // Only ranged actors stop short; hounds close fully once inside contact range.
  const stop = enemy.kind === 'wraith' ? Math.min(4.2, distance) : 0;
  const target = { x: player.x - x / distance * stop - y / distance * offset,
    y: player.y - y / distance * stop + x / distance * offset };
  return clearLine(enemy, target, enemy.radius, world)
    && clearLine(target, player, WRAITH_STATS.shotRadius, world) ? target : player;
}

export function crowdSeparation(enemies) {
  const bodies = enemies.filter(e => e.hp > 0 && e.kind !== 'ritual')
    .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const forces = new Map(bodies.map(e => [e.id, { x: 0, y: 0 }]));
  // Accumulate from one snapshot, so earlier movers cannot push later movers twice.
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], reach = a.radius + b.radius + .45;
    let x = a.x - b.x, y = a.y - b.y;
    const distance = Math.hypot(x, y);
    if (distance >= reach) continue;
    if (distance > 1e-8) { x /= distance; y /= distance; }
    else {
      const angle = fraction(`${a.id}:${b.id}`) * Math.PI * 2;
      x = Math.cos(angle); y = Math.sin(angle);
    }
    const strength = 2 * (1 - distance / reach), fa = forces.get(a.id), fb = forces.get(b.id);
    fa.x += x * strength; fa.y += y * strength;
    fb.x -= x * strength; fb.y -= y * strength;
  }
  for (const force of forces.values()) {
    const length = Math.hypot(force.x, force.y);
    if (length > 1.75) { force.x *= 1.75 / length; force.y *= 1.75 / length; }
  }
  return forces;
}

export function firingAdjustment(enemy, player, force, world) {
  if (!force || Math.hypot(force.x, force.y) < .02 || Math.hypot(enemy.x - player.x, enemy.y - player.y) < 2.15) return enemy;
  const target = { x: enemy.x + force.x * .5, y: enemy.y + force.y * .5 };
  return Math.hypot(target.x - player.x, target.y - player.y) <= WRAITH_STATS.attackRange
    && clearLine(enemy, target, enemy.radius, world)
    && clearLine(target, player, WRAITH_STATS.shotRadius, world) ? target : enemy;
}
