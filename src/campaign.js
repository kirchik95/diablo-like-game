// Immutable geometry and spawn definitions. Per-run combat state lives in game.js.
import { isWalkable } from './world.js';
import { CAMP_LAYOUT } from './camp-layout.js';

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
    obstacles: record.setDressing ? record.setDressing.filter(p => p.collider).map(p => p.collider) : [
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
export const WRAITH_STATS = freeze({
  hp: 64, speed: 1.15, aggroRange: 7.5, attackRange: 5.5,
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

export const LOCATIONS = freeze({
  camp: location({
    id: 'camp', title: 'Лагерь странников', subtitle: 'Тёплый огонь перед дорогой',
    ...CAMP_LAYOUT,
    portals: [{ id: 'camp-road', ...CAMP_LAYOUT.exit, target: 'road', label: 'Разбитая дорога' }],
    encounters: [],
  }),
  road: location({
    id: 'road', title: 'Разбитая дорога', subtitle: 'Главный путь и забытая боковая тропа',
    regions: [[-3, 3, 14, 21], [-6, 6, 4, 15], [-3, 3, -1, 5], [-6, 6, -11, 0],
      [-3, 3, -19, -10], [-14, -5, 4, 10], [-19, -11, -4, 10], [-12, -5, -4, 1]],
    pavingRoutes: [
      { width: 2.4, points: [[0, 19], [0, -17]] },
      { width: 1.5, points: [[0, 10], [-4, 8], [-6, 8], [-14, 8], [-16, 6],
        [-16, 1], [-14, -2], [-11, -2], [-6, -2], [0, -2]] },
    ],
    spawn: { x: 0, y: 17 }, entries: { camp: { x: 0, y: 17 }, courtyard: { x: 0, y: -14 } },
    exit: { x: 0, y: -17 }, shrine: { x: -16, y: 6 }, secret: { x: -16, y: 1 },
    pillars: [{ x: 3, y: 10, height: 1.8 }, { x: -4, y: -6, height: 2.8 },
      { x: 4, y: -6, height: 2.1 }, { x: -17.5, y: -1, height: 1.6 }],
    braziers: [{ x: -4, y: 13, color: 'cyan' }, { x: 4, y: 13, color: 'cyan' },
      { x: 3.5, y: -9, color: 'pink' }, { x: -17.5, y: 7, color: 'cyan' }],
    portals: [{ id: 'road-camp', x: 0, y: 19, target: 'camp', label: 'Лагерь странников' },
      { id: 'road-courtyard', x: 0, y: -17, target: 'courtyard', label: 'Двор монастыря' }],
    encounters: [
      { id: 'road-hound-1', kind: 'hound', x: 0, y: 9 },
      { id: 'road-hound-2', kind: 'hound', x: -2.5, y: -6 },
      { id: 'road-hound-3', kind: 'hound', x: 2.5, y: -6 },
      { id: 'road-wraith-1', kind: 'wraith', x: 0, y: 0 },
      { id: 'road-hound-secret', kind: 'hound', x: -11, y: -2 },
      { id: 'road-wraith-secret', kind: 'wraith', x: -14, y: 4 },
    ],
  }),
  courtyard: location({
    id: 'courtyard', title: 'Двор монастыря', subtitle: 'Стражи пепельного источника',
    regions: [[-8, 8, -9, 6], [-7, 7, -11, 8], [-3, 3, 9, 14]],
    pavingRoutes: [{ width: 2.4, points: [[0, 12.5], [0, -6]] }],
    spawn: { x: 0, y: 10 }, entries: { road: { x: 0, y: 10 } },
    exit: { x: 0, y: -9 }, ritual: { x: 0, y: -6 },
    pillars: [{ x: -5, y: -3, height: 2.8 }, { x: 5, y: -3, height: 2.8 },
      { x: -5, y: 4, height: 1.5 }, { x: 5, y: 4, height: 1.5 }],
    braziers: [{ x: -2.5, y: -8, color: 'pink' }, { x: 2.5, y: -8, color: 'pink' },
      { x: -6, y: 1, color: 'cyan' }, { x: 6, y: 1, color: 'cyan' }],
    portals: [{ id: 'courtyard-road', x: 0, y: 12.5, target: 'road', label: 'Разбитая дорога' }],
    encounters: [
      { id: 'court-hound-1', kind: 'hound', x: -1, y: 0 },
      { id: 'court-hound-2', kind: 'hound', x: 3, y: -1 },
      { id: 'court-wraith-1', kind: 'wraith', x: -3, y: -5 },
      { id: 'court-wraith-2', kind: 'wraith', x: 3, y: -5 },
    ],
  }),
});
