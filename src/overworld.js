// Local layouts remain useful authoring references; gameplay uses their union.
import { LOCATIONS } from './campaign.js';
import { createEncounterLayout, normalizeWorldSeed, DEFAULT_WORLD_SEED } from './encounter-layout.js';
import { isWalkable } from './world.js';
import { SIDE_ZONES, sideZoneAt } from './side-zones.js';
export { DEFAULT_WORLD_SEED } from './encounter-layout.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const uniqueTiles = points => [...new Map(points.map(p => [`${p.x},${p.y}`, p])).values()];

function translateZone(source, offset) {
  // Authored props move with their ground centres and every collider.
  const point = p => p && ({ ...p, x: p.x + offset.x, y: p.y + offset.y,
    ...(p.collider ? { collider: point(p.collider) } : {}), ...(p.contact ? { contact: point(p.contact) } : {}),
    ...(p.colliders ? { colliders: p.colliders.map(point) } : {}) });
  const zone = { ...source, offset,
    regions: source.regions.map(([x0, x1, y0, y1]) => [x0 + offset.x, x1 + offset.x, y0 + offset.y, y1 + offset.y]),
    entries: Object.fromEntries(Object.entries(source.entries).map(([id, p]) => [id, point(p)])),
    portals: [],
  };
  for (const key of ['tiles', 'paving', 'pillars', 'braziers', 'obstacles', 'setDressing']) {
    if (source[key]) zone[key] = source[key].map(point);
  }
  for (const key of ['spawn', 'exit', 'shrine', 'secret', 'ritual', 'reward']) zone[key] = point(source[key]);
  // COURTYARD_LAYOUT's flagstone floor outline, for the ground surface.
  if (source.flagstones) zone.flagstones = source.flagstones.map(([x, y]) => [x + offset.x, y + offset.y]);
  // CAMP_LAYOUT keeps its authored path data for its art plan.
  if (source.pavingRoutes) zone.pavingRoutes = source.pavingRoutes.map(route => ({ ...route,
    points: route.points.map(([x, y]) => [x + offset.x, y + offset.y]) }));
  return zone;
}

// The spine keeps indices 0..2; the optional side zones follow with their area boxes.
const zones = [translateZone(LOCATIONS.camp, { x: 0, y: 0 }),
  translateZone(LOCATIONS.road, { x: 0, y: -72 }),
  translateZone(LOCATIONS.courtyard, { x: 0, y: -120 }),
  ...['cemetery', 'orchard'].map(id => ({ ...translateZone(LOCATIONS[id], SIDE_ZONES[id].offset), area: SIDE_ZONES[id].area }))];
// Every zone lists its caches and healing shrines by id; `secret` and `shrine` stay for older
// callers. The road's cache keeps the id 'secret' (its loot site).
for (const zone of zones) {
  zone.caches = zone.secret ? [{ id: zone.id === 'road' ? 'secret' : `${zone.id}-cache`, zoneId: zone.id, ...zone.secret }] : [];
  zone.shrines = zone.shrine ? [{ id: `${zone.id}-shrine`, zoneId: zone.id, ...zone.shrine }] : [];
}

// Like the camp road, the worn earth of the road bends gently inside the
// expanded walk mask; it stays straight at both seams. Paving is appearance
// only (ground mask, ground cover and footstep sounds), never collision.
const ROAD_EARTH = [
  { width: 3.1, points: [[0, -41], [0, -47], [.7, -52], [1.3, -57], [.7, -62], [-.7, -68], [-1.1, -72],
    [-.4, -78], [.8, -83], [1, -87], [0, -94], [0, -101]] },
  { width: 1.8, points: [[.8, -65], [5.6, -65.3], [10.5, -65], [15, -65]] },
  { width: 1.7, points: [[.7, -59], [-3.6, -60], [-8.4, -60.5], [-14, -60], [-19, -61], [-22, -63],
    [-23, -68], [-22, -72], [-19, -75], [-14, -75.5], [-8.4, -75], [-3.6, -75.5], [-.6, -75]] },
];
const segmentDistance = (p, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - ax - dx * t, p.y - ay - dy * t);
};
zones[1].paving = zones[1].tiles.filter(p => ROAD_EARTH.some(route => route.points.slice(1).some((to, i) =>
  segmentDistance(p, route.points[i], to) <= route.width / 2)) && isWalkable(p.x, p.y, Math.SQRT1_2, zones[1]));

const joins = [];
for (const [start, end] of [[-45, -38], [-104, -95]]) {
  for (let y = start; y <= end; y++) for (let x = -1; x <= 1; x++) joins.push({ x, y });
}

const geography = freeze({
  id: 'overworld', title: 'Монастырские предгорья', subtitle: 'Непрерывная дорога от огня к источнику',
  tiles: uniqueTiles(zones.flatMap(zone => zone.tiles)),
  paving: uniqueTiles([...zones.flatMap(zone => zone.paving), ...joins]),
  regions: zones.flatMap(zone => zone.regions),
  obstacles: zones.flatMap(zone => zone.obstacles),
  pillars: zones.flatMap(zone => zone.pillars), braziers: zones.flatMap(zone => zone.braziers),
  spawn: zones[0].spawn, entries: {}, exit: zones[2].exit,
  shrine: zones[1].shrine, secret: zones[1].secret, ritual: zones[2].ritual, reward: zones[0].reward,
  // All caches and shrines; `secret` and `shrine` above stay the road's.
  caches: zones.flatMap(zone => zone.caches), shrines: zones.flatMap(zone => zone.shrines),
  portals: [], safeArea: { minY: -41.5, maxY: 34 },
});

function buildOverworld(seed) {
  const encounters = createEncounterLayout(geography, seed);
  return freeze({ ...geography, seed, encounters,
    zones: zones.map(zone => ({ ...zone, encounters: encounters.filter(e => e.zoneId === zone.id) })) });
}

export const OVERWORLD = buildOverworld(DEFAULT_WORLD_SEED);

export function createOverworld(seed = DEFAULT_WORLD_SEED) {
  seed = normalizeWorldSeed(seed);
  return seed === DEFAULT_WORLD_SEED ? OVERWORLD : buildOverworld(seed);
}

// Area identity is presentation/quest context, never a scene or coordinate swap.
// A side zone's area box wins over the spine's y bands.
export function getOverworldZone(x, y) {
  const side = sideZoneAt(x, y);
  if (side) return OVERWORLD.zones.find(zone => zone.id === side);
  return y >= -41.5 ? OVERWORLD.zones[0] : y >= -99.5 ? OVERWORLD.zones[1] : OVERWORLD.zones[2];
}
