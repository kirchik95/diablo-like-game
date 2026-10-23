// Local layouts remain useful authoring references; gameplay uses their union.
import { LOCATIONS } from './campaign.js';
import { createEncounterLayout, normalizeWorldSeed, DEFAULT_WORLD_SEED } from './encounter-layout.js';
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
  const point = p => p && ({ ...p, x: p.x + offset.x, y: p.y + offset.y,
    ...(p.collider ? { collider: point(p.collider) } : {}) });
  const zone = { ...source, offset,
    regions: source.regions.map(([x0, x1, y0, y1]) => [x0 + offset.x, x1 + offset.x, y0 + offset.y, y1 + offset.y]),
    entries: Object.fromEntries(Object.entries(source.entries).map(([id, p]) => [id, point(p)])),
    portals: [],
  };
  for (const key of ['tiles', 'paving', 'pillars', 'braziers', 'obstacles', 'setDressing']) {
    if (source[key]) zone[key] = source[key].map(point);
  }
  for (const key of ['spawn', 'exit', 'shrine', 'secret', 'ritual', 'reward']) zone[key] = point(source[key]);
  // CAMP_LAYOUT keeps its authored path data for its art plan.
  if (source.pavingRoutes) zone.pavingRoutes = source.pavingRoutes.map(route => ({ ...route,
    points: route.points.map(([x, y]) => [x + offset.x, y + offset.y]) }));
  return zone;
}

const zones = [translateZone(LOCATIONS.camp, { x: 0, y: 0 }),
  translateZone(LOCATIONS.road, { x: 0, y: -51 }),
  translateZone(LOCATIONS.courtyard, { x: 0, y: -85 })];

const joins = [];
for (const [start, end] of [[-32, -27], [-74, -67]]) {
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
  portals: [], safeArea: { minY: -29.5, maxY: 24 },
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
export function getOverworldZone(x, y) {
  return y >= -29.5 ? OVERWORLD.zones[0] : y >= -70.5 ? OVERWORLD.zones[1] : OVERWORLD.zones[2];
}
