// Immutable geometry and spawn definitions. Per-run combat state lives in game.js.
import { isWalkable } from './world.js';
import { CAMP_LAYOUT } from './camp-layout.js';
import { COURTYARD_LAYOUT } from './courtyard-layout.js';
import { CEMETERY_LAYOUT } from './cemetery-layout.js';
import { ORCHARD_LAYOUT } from './orchard-layout.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const tiles = regions => {
  const result = new Map();
  for (const [x0, x1, y0, y1] of regions) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.set(`${x},${y}`, { x, y });
  }
  return [...result.values()];
};
const distanceToSegment = (point, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length2)) : 0;
  return Math.hypot(point.x - ax - dx * t, point.y - ay - dy * t);
};
const location = ({ pavingRoutes, ...record }) => {
  const world = {
    shrine: null, secret: null, ritual: null, reward: null,
    ...record,
    tiles: tiles(record.regions),
    // An L-shaped wall corner or an arch carries one collider per arm or pier.
    obstacles: record.setDressing ? record.setDressing.flatMap(p => p.colliders ?? (p.collider ? [p.collider] : [])) : [
      ...record.pillars.map(p => ({ x: p.x, y: p.y, halfSize: Math.SQRT1_2 })),
      ...record.braziers.map(p => ({ x: p.x, y: p.y, radius: .22 })),
    ],
  };
  // Paving describes appearance only; the broader plateau remains walkable.
  // A cell's bounding radius keeps its whole surface clear of prop foundations.
  world.paving = world.tiles.filter(point => pavingRoutes.some(route => route.points.slice(1).some((to, i) =>
    distanceToSegment(point, route.points[i], to) <= route.width / 2))
    && isWalkable(point.x, point.y, Math.SQRT1_2, world));
  return world;
};

export const WRAITH_TIMINGS = freeze({ windup: .8, recover: .6, stunned: .38 });
// Monster health lives only in MONK_RULES.enemyHp (wraith 76); the zone's monster level scales it.
export const WRAITH_STATS = freeze({
  speed: 1.15, aggroRange: 7.5, attackRange: 5.5,
  shotSpeed: 5.5, shotRadius: .13, shotLife: 2.2, shotDamage: 12,
});
// The armored beetle blocks from its front arc; dash and wave expose it.
// Arc values are cosines between its facing and the direction to the target.
// After an exposed stun ends, breakImmunity seconds pass before the shell can break again.
export const BEETLE_TIMINGS = freeze({ windup: .8, slam: .15, recover: .9, exposed: 1.6, breakImmunity: 1, cooldown: .5 });
export const BEETLE_STATS = freeze({
  radius: .38, speed: 1.1, turnRate: 2.5, minTurnSpeed: .3, aggroRange: 4.5, holdRange: .95,
  attackRange: 1.2, attackDot: .8, slamRange: 1.3, slamDot: .5, slamDamage: 22,
  guardDot: .5, blockDamage: .25, blockKnockback: .1,
});
export const ADVENTURE_RULES = freeze({ interactionRadius: 1.15, cacheHeal: 25, ritualHp: 132 });
// The E point of the camp supply cache: screen-down of the cache (world +x +y on the fixed camera),
// .45u past the collider face the diagonal leaves through. The supplies cloth then lies in front of
// the chest drawing, and the point stays walkable and out of reach of the reward point.
const supplyCache = CAMP_LAYOUT.setDressing.find(p => p.id === 'supplies').collider;
const supplyFront = Math.min(supplyCache.halfWidth, supplyCache.halfDepth) + .45;
export const CAMP_SUPPLIES = freeze({ x: supplyCache.x + supplyFront, y: supplyCache.y + supplyFront });

export const LOCATIONS = freeze({
  camp: location({
    id: 'camp', title: 'Лагерь странников', subtitle: 'Тёплый огонь перед дорогой',
    ...CAMP_LAYOUT,
    portals: [{ id: 'camp-road', ...CAMP_LAYOUT.exit, target: 'road', label: 'Разбитая дорога' }],
    encounters: [],
  }),
  road: location({
    id: 'road', title: 'Разбитая дорога', subtitle: 'Главный путь и забытая боковая тропа',
    regions: [[-4, 4, 20, 30], [-9, 9, 6, 21], [-4, 4, -2, 7], [-9, 9, -16, 0],
      [-4, 4, -27, -14], [-20, -7, 6, 14], [-27, -15, -6, 14], [-17, -7, -6, 1], [10, 14, 6, 8]],
    pavingRoutes: [
      { width: 2.8, points: [[0, 29], [0, -26]] },
      { width: 1.7, points: [[0, 14], [-6, 11], [-20, 11], [-23, 8], [-23, 1], [-20, -3], [-9, -3], [0, -3]] },
    ],
    spawn: { x: 0, y: 24 }, entries: { camp: { x: 0, y: 24 }, courtyard: { x: 0, y: -20 } },
    exit: { x: 0, y: -25 }, shrine: { x: -23, y: 8 }, secret: { x: -23, y: 1 },
    pillars: [{ x: 4.2, y: 14, height: 1.8 }, { x: -5.6, y: -8.4, height: 2.8 },
      { x: 5.6, y: -8.4, height: 2.1 }, { x: -24.5, y: -1.4, height: 1.6 }],
    braziers: [{ x: -5.6, y: 18.2, color: 'cyan' }, { x: 5.6, y: 18.2, color: 'cyan' },
      { x: 4.9, y: -12.6, color: 'pink' }, { x: -24.5, y: 9.8, color: 'cyan' }],
    portals: [{ id: 'road-camp', x: 0, y: 27, target: 'camp', label: 'Лагерь странников' },
      { id: 'road-courtyard', x: 0, y: -25, target: 'courtyard', label: 'Двор монастыря' }],
    encounters: [
      { id: 'road-hound-1', kind: 'hound', x: 0, y: 12.6 },
      { id: 'road-hound-2', kind: 'hound', x: -3.5, y: -8.4 },
      { id: 'road-hound-3', kind: 'hound', x: 3.5, y: -8.4 },
      { id: 'road-wraith-1', kind: 'wraith', x: 0, y: 0 },
      { id: 'road-hound-secret', kind: 'hound', x: -15.4, y: -2.8 },
      { id: 'road-wraith-secret', kind: 'wraith', x: -19.6, y: 5.6 },
    ],
  }),
  courtyard: location({
    id: 'courtyard', title: 'Двор монастыря', subtitle: 'Стражи пепельного источника',
    ...COURTYARD_LAYOUT,
    portals: [{ id: 'courtyard-road', x: 0, y: 17.5, target: 'road', label: 'Разбитая дорога' }],
    encounters: [
      { id: 'court-hound-1', kind: 'hound', x: -1.4, y: 0 },
      { id: 'court-hound-2', kind: 'hound', x: 4.2, y: -1.4 },
      { id: 'court-wraith-1', kind: 'wraith', x: -4.2, y: -7 },
      { id: 'court-wraith-2', kind: 'wraith', x: 4.2, y: -7 },
    ],
  }),
  // Optional side zones (side-zones.js); the world's encounter layout fills them.
  cemetery: location({
    id: 'cemetery', title: 'Старое кладбище', subtitle: 'Монахи спят под тисами',
    ...CEMETERY_LAYOUT, portals: [], encounters: [],
  }),
  orchard: location({
    id: 'orchard', title: 'Сад обители', subtitle: 'Оливы помнят тишину',
    ...ORCHARD_LAYOUT, portals: [], encounters: [],
  }),
});
