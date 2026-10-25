import { isWalkable } from './world.js';
import { BEETLE_STATS } from './campaign.js';
import { monsterLevelForZone, xpReward } from './progression.js';
import { SIDE_LINKS, sideZoneAt } from './side-zones.js';

export const DEFAULT_WORLD_SEED = 20261023;

// Authored encounter areas preserve the route's pacing, not individual rows.
// A seed spawns the first `kinds.length - 2` or `kinds.length - 1` kinds of an area, never fewer
// than 3, so every pack keeps its leading beetle and wraith and only the trailing members vary.
// The larger clearings carry 6–8 members per spine pack. The first approach remains
// free of beetles; the later gate and source add a second armored guard.
const areas = [
  { id: 'road-approach', zoneId: 'road', x: 0, y: -59.12, rx: 4.34, ry: 3.92,
    kinds: ['hound', 'hound', 'wraith', 'wraith', 'hound', 'hound', 'wraith', 'hound', 'hound'] },
  { id: 'road-crossing', zoneId: 'road', x: 0.7, y: -74.8, rx: 4.48, ry: 3.92,
    kinds: ['beetle', 'hound', 'wraith', 'hound', 'wraith', 'hound', 'hound', 'wraith', 'hound'] },
  { id: 'road-gate', zoneId: 'road', x: 0, y: -89.92, rx: 4.34, ry: 3.78,
    kinds: ['beetle', 'hound', 'wraith', 'hound', 'hound', 'beetle', 'hound', 'hound'] },
  { id: 'road-thicket', zoneId: 'road', x: -21.56, y: -67.1, rx: 4.2, ry: 6.58,
    kinds: ['hound', 'wraith', 'beetle', 'hound', 'wraith', 'hound', 'beetle', 'hound', 'hound'] },
  { id: 'court-entrance', zoneId: 'courtyard', x: 0, y: -113.84, rx: 7.7, ry: 4.06,
    kinds: ['hound', 'beetle', 'hound', 'wraith', 'wraith', 'hound', 'wraith', 'hound', 'hound'] },
  { id: 'court-source', zoneId: 'courtyard', x: 0, y: -131, rx: 6.58, ry: 3.1,
    kinds: ['beetle', 'hound', 'hound', 'wraith', 'wraith', 'hound', 'beetle', 'hound', 'hound'] },
];

// Wanderers: singles, pairs and trios between the packs, as in Diablo. They spawn only
// in these spots, which keep off the main road's narrow stretches (beside the thicket island and
// the gate corridor). `side` spots lie on the side trail, off the main path.
const wanderAreas = [
  { id: 'trail-north', zoneId: 'road', x0: -18.2, x1: -8.4, y0: -65.7, y1: -58.7, weight: 2, side: true },
  { id: 'trail-south', zoneId: 'road', x0: -18.2, x1: -7.7, y0: -77.6, y1: -71.3, weight: 2, side: true },
  { id: 'road-verge', zoneId: 'road', x0: 4.9, x1: 9.1, y0: -67.1, y1: -61.5, weight: 1.5 },
  { id: 'road-bend', zoneId: 'road', x0: -9.1, x1: 9.1, y0: -86.7, y1: -81.8, weight: 1.5 },
  { id: 'court-west', zoneId: 'courtyard', x0: -11.2, x1: -7.7, y0: -127.7, y1: -116.5, weight: 1 },
  { id: 'court-east', zoneId: 'courtyard', x0: 7.7, x1: 11.2, y0: -127.7, y1: -116.5, weight: 1 },
  { id: 'court-far', zoneId: 'courtyard', x0: -11.2, x1: 11.2, y0: -134.7, y1: -130.5, weight: 1 },
];
const wanderKinds = { road: [['hound', .75], ['wraith', .25]],
  courtyard: [['hound', .45], ['wraith', .4], ['beetle', .15]],
  cemetery: [['hound', .5], ['wraith', .5]], orchard: [['hound', .45], ['wraith', .35], ['beetle', .2]] };
const wanderSizes = [[1, .4], [2, .4], [3, .2]];

// The side zones (side-zones.js) take two packs each and a few wanderers, placed after the main
// layout from their own random streams. Their packs follow the main size rule.
export const sideAreas = [
  { id: 'cemetery-graves', zoneId: 'cemetery', x: 26.6, y: -63.1, rx: 4.62, ry: 3.92,
    kinds: ['wraith', 'hound', 'wraith', 'hound', 'wraith', 'hound', 'beetle', 'hound', 'wraith'] },
  { id: 'cemetery-obelisk', zoneId: 'cemetery', x: 28, y: -80, rx: 5.32, ry: 3.22,
    kinds: ['beetle', 'wraith', 'wraith', 'hound', 'hound', 'wraith', 'beetle', 'beetle', 'wraith', 'hound'] },
  { id: 'orchard-press', zoneId: 'orchard', x: -24.22, y: -113.7, rx: 4.62, ry: 4.2,
    kinds: ['beetle', 'hound', 'wraith', 'hound', 'hound', 'wraith', 'beetle', 'hound', 'wraith'] },
  { id: 'orchard-well', zoneId: 'orchard', x: -28, y: -130.64, rx: 5.04, ry: 3.64,
    kinds: ['beetle', 'hound', 'wraith', 'hound', 'wraith', 'beetle', 'beetle', 'wraith', 'hound', 'hound'] },
];
export const sideWanderAreas = [
  { id: 'cemetery-east', zoneId: 'cemetery', x0: 37.1, x1: 40.6, y0: -75, y1: -59.6, weight: 1 },
  { id: 'cemetery-northeast', zoneId: 'cemetery', x0: 34.3, x1: 39.2, y0: -87.6, y1: -82, weight: 1 },
  { id: 'orchard-terrace', zoneId: 'orchard', x0: -40.6, x1: -33.6, y0: -121.4, y1: -111.6, weight: 1 },
  { id: 'orchard-north', zoneId: 'orchard', x0: -36.4, x1: -19.6, y0: -136.8, y1: -135.4, weight: .6 },
  { id: 'orchard-east', zoneId: 'orchard', x0: -22.4, x1: -19.6, y0: -136.8, y1: -122.8, weight: 1 },
];
// Side wanderers: 4 to 6 groups of one or two, at most 6 in a zone, topped up until the full
// clear with both zones reaches its band (docs/design/world-expansion.md §5.3).
export const SIDE_RULES = { groups: [4, 6], mostGroups: 8, fullClearXp: [2150, 2550], zoneMembers: 6,
  sizes: [[1, .5], [2, .5]], packGap: 5, groupGap: 5, reserveGap: 3, spread: [1.4, 2.2] };

// groups: rolled wander groups per run, and the most a run may reach while it tops up to the
// lowest full-clear experience. fullClearXp: the §4.3 band of the full clear (packs with their
// bonus, the cache, the source and the wanderers). courtyardGroups: more only when the road spots
// are full. Gaps: to pack members, to other groups and to the shrine, cache and source.
// spread: distance of group members from the first one.
const WANDER_RULES = { groups: [6, 9], mostGroups: 14, fullClearXp: [1100, 1300], courtyardGroups: 3,
  packGap: 5, groupGap: 5, reserveGap: 3, spread: [1.4, 2.2] };

// Spawn clearance keeps the same .25 margin around the wider beetle body.
const SPAWN_CLEARANCE = { hound: .54, wraith: .54, beetle: BEETLE_STATS.radius + .25 };

export function normalizeWorldSeed(seed = DEFAULT_WORLD_SEED) {
  return Number.isFinite(seed) ? seed >>> 0 : DEFAULT_WORLD_SEED;
}

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted choice for a uniform draw u in [0, 1).
const choose = (u, table) => {
  let n = u * table.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of table) if ((n -= weight) < 0) return value;
  return table.at(-1)[0];
};
const pick = (random, table) => choose(random(), table);
// Kinds of a wander group in a zone, one draw per member. A beetle always wanders alone.
const groupKinds = (draws, zoneId) => {
  const table = wanderKinds[zoneId].filter(([kind]) => draws.length === 1 || kind !== 'beetle');
  return draws.map(u => choose(u, table));
};
const killXp = (kinds, zoneId) => kinds.reduce((sum, kind) => sum + xpReward(kind, monsterLevelForZone(zoneId)), 0);

// Rules every spawn shares: clearance, the camp and courtyard-seam buffers and spacing.
function spawnFits(world, placed, point, kind) {
  return isWalkable(point.x, point.y, SPAWN_CLEARANCE[kind], world) && point.y < world.safeArea.minY - 7
    && Math.abs(point.y + 99.5) >= 3 && !placed.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 1.35);
}

// list: the main areas, or the side areas from index `first` (its seed streams follow the main
// ones). reserved: the points a pack keeps 2.2 away from.
function placePacks(world, seed, placed, list = areas, first = 0, reserved = [world.shrine, world.secret, world.ritual].filter(Boolean)) {
  for (const [index, area] of list.entries()) {
    const areaIndex = first + index;
    const random = randomFor(seed ^ Math.imul(areaIndex + 1, 0x9e3779b1));
    const count = Math.max(3, area.kinds.length - 2 + Math.floor(random() * 2));
    const members = [];
    const accept = point => {
      const index = members.length, kind = area.kinds[index];
      if (!spawnFits(world, placed, point, kind)) return false;
      // Keep every other pack beyond the longest aggro range (wraith 7.5).
      if (placed.some(p => !p.wander && p.packId !== area.id && Math.hypot(point.x - p.x, point.y - p.y) < 7.6)) return false;
      if (reserved.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 2.2)) return false;
      // Avoid three almost-aligned members on either world or isometric axis.
      for (const project of [p => p.x, p => p.y, p => p.x + p.y, p => p.y - p.x]) {
        if (members.filter(p => Math.abs(project(p) - project(point)) < .18).length >= 2) return false;
      }
      const enemy = { id: `${area.id}-${index + 1}`, kind, zoneId: area.zoneId, packId: area.id, ...point };
      members.push(enemy); placed.push(enemy);
      return true;
    };
    for (let attempt = 0; attempt < 768 && members.length < count; attempt++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
      accept({ x: area.x + Math.cos(angle) * radius * area.rx, y: area.y + Math.sin(angle) * radius * area.ry });
    }
    // A finite, deterministic fallback covers unlucky rejection sequences.
    // It follows a rotated spiral rather than putting actors back on grid rows.
    // A pack that still lacks room keeps the members already placed: a run never fails to start.
    const rotation = random() * Math.PI * 2;
    for (let i = 1; i <= 1024 && members.length < count; i++) {
      const angle = rotation + i * Math.PI * (3 - Math.sqrt(5)), radius = Math.sqrt(i / 1024);
      accept({ x: area.x + Math.cos(angle) * radius * area.rx, y: area.y + Math.sin(angle) * radius * area.ry });
    }
  }
}

function placeWanderers(world, seed, placed) {
  const random = randomFor(Math.imul(seed ^ 0x57414e44, 0x85ebca6b));
  const reserved = [world.shrine, world.secret, world.ritual].filter(Boolean);
  const packMembers = [...placed], wanderers = [], full = new Set();
  const { groups: [fewest, most], fullClearXp: [lowXp, highXp], spread: [near, far] } = WANDER_RULES;
  const flat = xpReward('pack') * areas.length + xpReward('secret') + xpReward('ritual');
  let xp = flat + packMembers.reduce((sum, e) => sum + killXp([e.kind], e.zoneId), 0), groups = 0, courtyard = 0;
  const clear = (point, others, gap) => others.every(p => Math.hypot(point.x - p.x, point.y - p.y) >= gap);
  // Packs and other groups stand beyond the 1.35 spawn spacing, so only the group's own members need it.
  const fits = (area, point, kind, members) => point.x >= area.x0 && point.x <= area.x1
    && point.y >= area.y0 && point.y <= area.y1 && clear(point, packMembers, WANDER_RULES.packGap)
    && clear(point, wanderers, WANDER_RULES.groupGap) && clear(point, reserved, WANDER_RULES.reserveGap)
    && spawnFits(world, members, point, kind);
  // Random anchors first, then a finite, deterministic spiral over the whole spot. Members try
  // random places around the anchor, then a fixed ring. A spot with no room for a single
  // hound or wraith stays full for the rest of the run.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const placeGroup = (area, kinds) => {
    const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
    const rx = (area.x1 - area.x0) * Math.SQRT1_2, ry = (area.y1 - area.y0) * Math.SQRT1_2;
    const anchors = [...Array.from({ length: 48 }, () => ({ x: area.x0 + random() * (area.x1 - area.x0),
      y: area.y0 + random() * (area.y1 - area.y0) })), ...Array.from({ length: 128 }, (_, i) => ({
      x: cx + Math.cos(i * golden) * Math.sqrt(i / 128) * rx, y: cy + Math.sin(i * golden) * Math.sqrt(i / 128) * ry }))];
    for (const anchor of anchors) {
      if (!fits(area, anchor, kinds[0], [])) continue;
      const members = [anchor], turn = random() * Math.PI * 2;
      for (const kind of kinds.slice(1)) {
        const around = [...Array.from({ length: 16 }, () => [random() * Math.PI * 2, near + random() * (far - near)]),
          ...Array.from({ length: 24 }, (_, i) => [turn + i * Math.PI / 6, i < 12 ? near : far])];
        const point = around.map(([angle, radius]) => ({ x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius }))
          .find(p => fits(area, p, kind, members));
        if (point) members.push(point);
      }
      if (members.length === kinds.length) return members;
    }
    if (kinds.length === 1 && kinds[0] !== 'beetle') full.add(area);
    return null;
  };
  // One group of the given size: spots in weighted random order, courtyard spots past
  // `courtyardGroups` last, then one member fewer. A group never lifts the full clear past the band.
  const addGroup = size => {
    const draws = Array.from({ length: size }, random);
    const order = wanderAreas.map(area => [area, random() ** (1 / area.weight)])
      .sort((a, b) => b[1] - a[1]).map(([area]) => area).filter(area => !full.has(area));
    const open = area => area.zoneId !== 'courtyard' || courtyard < WANDER_RULES.courtyardGroups;
    for (const spots of [order.filter(open), order.filter(area => !open(area))]) {
      for (let take = size; take > 0; take--) for (const area of spots) {
        const kinds = groupKinds(draws.slice(0, take), area.zoneId), cost = killXp(kinds, area.zoneId);
        if (full.has(area) || xp + cost > highXp) continue;
        const points = placeGroup(area, kinds);
        if (!points) continue;
        const n = ++groups;
        const members = points.map((point, i) => ({ id: `wander-${n}-${i + 1}`, kind: kinds[i], zoneId: area.zoneId,
          packId: `wander-${n}`, wander: true, ...(area.side ? { side: true } : {}), ...point }));
        wanderers.push(...members); placed.push(...members);
        courtyard += area.zoneId === 'courtyard'; xp += cost;
        return true;
      }
    }
    return false;
  };
  // The seed rolls the group count and sizes. Every run shows a pair and one more pair or trio:
  // that pair takes its spot first, then the larger groups. Runs below the band add groups up to
  // `mostGroups`. When no spot has room, the run keeps fewer groups: this never throws.
  const sizes = Array.from({ length: fewest + Math.floor(random() * (most - fewest + 1)) }, () => pick(random, wanderSizes));
  if (!sizes.includes(2)) sizes[sizes.indexOf(sizes.includes(1) ? 1 : 3)] = 2;
  while (sizes.filter(size => size > 1).length < 2) sizes[sizes.indexOf(1)] = 2;
  sizes.sort((a, b) => b - a).splice(sizes.indexOf(2), 1);
  for (const size of [2, ...sizes]) addGroup(size);
  while (xp < lowXp && groups < WANDER_RULES.mostGroups && addGroup(pick(random, wanderSizes)));
  return xp;
}

// Side wanderers start from the full clear without the side zones (mainXp), the side packs with
// their bonus and the side caches. Groups that would lift the run past the band are skipped.
function placeSideWanderers(world, seed, placed, mainXp, sidePacks, reserved) {
  const random = randomFor(Math.imul(seed ^ 0x53494445, 0x85ebca6b));
  const wanderers = [], full = new Set(), members = new Map();
  const { groups: [fewest, most], fullClearXp: [lowXp, highXp], spread: [near, far] } = SIDE_RULES;
  const sideCaches = world.caches.filter(cache => cache.zoneId !== 'road').length;
  let xp = mainXp + xpReward('pack') * sideAreas.length + xpReward('secret') * sideCaches
    + sidePacks.reduce((sum, e) => sum + killXp([e.kind], e.zoneId), 0), groups = 0;
  const clear = (point, others, gap) => others.every(p => Math.hypot(point.x - p.x, point.y - p.y) >= gap);
  const fits = (area, point, kind, group) => point.x >= area.x0 && point.x <= area.x1
    && point.y >= area.y0 && point.y <= area.y1 && clear(point, sidePacks, SIDE_RULES.packGap)
    && clear(point, wanderers, SIDE_RULES.groupGap) && clear(point, reserved, SIDE_RULES.reserveGap)
    && spawnFits(world, group, point, kind);
  // The main pass's search: random anchors, then a spiral; members around the anchor.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const placeGroup = (area, kinds) => {
    const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
    const rx = (area.x1 - area.x0) * Math.SQRT1_2, ry = (area.y1 - area.y0) * Math.SQRT1_2;
    const anchors = [...Array.from({ length: 48 }, () => ({ x: area.x0 + random() * (area.x1 - area.x0),
      y: area.y0 + random() * (area.y1 - area.y0) })), ...Array.from({ length: 128 }, (_, i) => ({
      x: cx + Math.cos(i * golden) * Math.sqrt(i / 128) * rx, y: cy + Math.sin(i * golden) * Math.sqrt(i / 128) * ry }))];
    for (const anchor of anchors) {
      if (!fits(area, anchor, kinds[0], [])) continue;
      const group = [anchor], turn = random() * Math.PI * 2;
      for (const kind of kinds.slice(1)) {
        const around = [...Array.from({ length: 16 }, () => [random() * Math.PI * 2, near + random() * (far - near)]),
          ...Array.from({ length: 24 }, (_, i) => [turn + i * Math.PI / 6, i < 12 ? near : far])];
        const point = around.map(([angle, radius]) => ({ x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius }))
          .find(p => fits(area, p, kind, group));
        if (point) group.push(point);
      }
      if (group.length === kinds.length) return group;
    }
    if (kinds.length === 1 && kinds[0] !== 'beetle') full.add(area);
    return null;
  };
  // One group: spots in weighted random order, then one member fewer; a zone holds at most
  // `zoneMembers` side wanderers.
  const addGroup = size => {
    const draws = Array.from({ length: size }, random);
    const order = sideWanderAreas.map(area => [area, random() ** (1 / area.weight)])
      .sort((a, b) => b[1] - a[1]).map(([area]) => area).filter(area => !full.has(area));
    for (let take = size; take > 0; take--) for (const area of order) {
      if (full.has(area) || take > SIDE_RULES.zoneMembers - (members.get(area.zoneId) ?? 0)) continue;
      const kinds = groupKinds(draws.slice(0, take), area.zoneId), cost = killXp(kinds, area.zoneId);
      if (xp + cost > highXp) continue;
      const points = placeGroup(area, kinds);
      if (!points) continue;
      const n = ++groups;
      const group = points.map((point, i) => ({ id: `side-wander-${n}-${i + 1}`, kind: kinds[i], zoneId: area.zoneId,
        packId: `side-wander-${n}`, wander: true, ...point }));
      wanderers.push(...group); placed.push(...group);
      members.set(area.zoneId, (members.get(area.zoneId) ?? 0) + take); xp += cost;
      return true;
    }
    return false;
  };
  const count = fewest + Math.floor(random() * (most - fewest + 1));
  for (let i = 0; i < count; i++) addGroup(pick(random, SIDE_RULES.sizes));
  while (xp < lowXp && groups < SIDE_RULES.mostGroups && addGroup(pick(random, SIDE_RULES.sizes)));
}

const inRegion = ([x0, x1, y0, y1], p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
// The main pass sees the spine alone, without the side zones and the cells that lead into them:
// main-path spawns stay those of the spine, and no monster waits in a side entrance.
const spineOf = world => ({ ...world,
  tiles: world.tiles.filter(p => !sideZoneAt(p.x, p.y) && !Object.values(SIDE_LINKS).some(link => inRegion(link, p))) });

export function createEncounterLayout(world, seed = DEFAULT_WORLD_SEED) {
  const placed = [], spine = spineOf(world);
  seed = normalizeWorldSeed(seed);
  placePacks(spine, seed, placed);
  const mainXp = placeWanderers(spine, seed, placed);
  // A world with side zones lists a cache outside the road.
  if (world.caches?.some(cache => cache.zoneId !== 'road')) {
    const reserved = [...world.caches, ...world.shrines ?? [], world.ritual].filter(Boolean), first = placed.length;
    placePacks(world, seed, placed, sideAreas, areas.length, reserved);
    placeSideWanderers(world, seed, placed, mainXp, placed.slice(first), reserved);
  }
  return placed;
}
