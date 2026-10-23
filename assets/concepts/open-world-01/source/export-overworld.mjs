// Snapshot OVERWORLD (gameplay) and the current renderer border/scenery layout
// for the Paper plan. Run: node assets/concepts/open-world-01/source/export-overworld.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { OVERWORLD, getOverworldZone } from '../../../../src/overworld.js';
import { layoutLandscape } from '../../../../src/landscape.js';

const out = new URL('./', import.meta.url);
const sha = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const r = v => Math.round(v * 1000) / 1000;
const tiles = OVERWORLD.tiles;
const xs = tiles.map(p => p.x), ys = tiles.map(p => p.y);
const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
const runs = rows => {
  const byY = new Map();
  for (const p of rows) (byY.get(p.y) ?? byY.set(p.y, []).get(p.y)).push(p.x);
  const result = [];
  for (const [y, list] of [...byY].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a - b);
    let start = list[0], prev = list[0];
    for (const x of list.slice(1).concat([Infinity])) {
      if (x !== prev + 1) { result.push([start, prev, y]); start = x; }
      prev = x;
    }
  }
  return result;
};
const zones = OVERWORLD.zones.map(z => ({ id: z.id, title: z.title, subtitle: z.subtitle, offset: z.offset,
  tileCount: z.tiles.length, minY: Math.min(...z.tiles.map(p => p.y)), maxY: Math.max(...z.tiles.map(p => p.y)),
  spawn: z.spawn, exit: z.exit, shrine: z.shrine, secret: z.secret, ritual: z.ritual, reward: z.reward,
  pillars: z.pillars.map(p => ({ x: r(p.x), y: r(p.y), height: p.height })), braziers: z.braziers.map(p => ({ x: r(p.x), y: r(p.y), color: p.color })),
  encounterCount: z.encounters.length }));
const obstacles = OVERWORLD.obstacles.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v)])));
const camp = OVERWORLD.zones[0];
const setDressing = camp.setDressing.map(p => ({ id: p.id, kind: p.kind, x: r(p.x), y: r(p.y), scale: r(p.scale), flip: p.flip,
  collider: p.collider && Object.fromEntries(Object.entries(p.collider).map(([k, v]) => [k, r(v)])) }));
const packs = [...new Set(OVERWORLD.encounters.map(e => e.packId))].map(id => {
  const list = OVERWORLD.encounters.filter(e => e.packId === id);
  return { id, zoneId: list[0].zoneId, size: list.length, hounds: list.filter(e => e.kind === 'hound').length,
    wraiths: list.filter(e => e.kind === 'wraith').length,
    center: { x: r(list.reduce((s, e) => s + e.x, 0) / list.length), y: r(list.reduce((s, e) => s + e.y, 0) / list.length) } };
});
const land = layoutLandscape(OVERWORLD);
const pick = p => ({ frame: p.frame, x: r(p.x), y: r(p.y), contact: { x: r(p.contact.x), y: r(p.contact.y) }, scale: r(p.scale), flip: p.flip, height: p.height });
const heights = [...land.cells.values()].map(c => c.height);
const data = {
  source: 'src/overworld.js OVERWORLD + src/landscape.js layoutLandscape(OVERWORLD)',
  generated: new Date().toISOString(),
  sha256: { 'src/overworld.js': sha('../../../../src/overworld.js'), 'src/campaign.js': sha('../../../../src/campaign.js'),
    'src/camp-layout.js': sha('../../../../src/camp-layout.js'), 'src/landscape.js': sha('../../../../src/landscape.js'),
    'src/country-border.js': sha('../../../../src/country-border.js') },
  title: OVERWORLD.title, subtitle: OVERWORLD.subtitle, bounds,
  extentUnits: { width: bounds.maxX - bounds.minX + 1, depth: bounds.maxY - bounds.minY + 1 },
  tileCount: tiles.length, pavingCount: OVERWORLD.paving.length, portals: OVERWORLD.portals.length,
  safeArea: OVERWORLD.safeArea, seams: [-29.5, -70.5],
  seamCheck: { 'y=-29': getOverworldZone(0, -29).id, 'y=-30': getOverworldZone(0, -30).id, 'y=-70': getOverworldZone(0, -70).id, 'y=-71': getOverworldZone(0, -71).id },
  points: { spawn: OVERWORLD.spawn, exit: OVERWORLD.exit, shrine: OVERWORLD.shrine, secret: OVERWORLD.secret, ritual: OVERWORLD.ritual,
    reward: OVERWORLD.reward },
  zones, packs, encounters: OVERWORLD.encounters.map(e => ({ id: e.id, kind: e.kind, zoneId: e.zoneId, packId: e.packId, x: e.x, y: e.y })),
  tileRuns: runs(tiles), pavingRuns: runs(OVERWORLD.paving), obstacles, campSetDressing: setDressing,
  renderer: { note: 'Snapshot of the renderer layout at the source sha256 values and generated date listed above; it may become stale after later source changes.',
    cellHeights: { min: Math.min(...heights), max: Math.max(...heights) },
    border: land.border.map(pick), scenery: land.scenery.map(pick) },
};
writeFileSync(new URL('overworld-snapshot.json', out), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ bounds, extent: data.extentUnits, tiles: tiles.length, paving: data.pavingCount, packs, seamCheck: data.seamCheck,
  obstacles: obstacles.length, border: land.border.length, scenery: land.scenery.length, heights: data.renderer.cellHeights, points: data.points,
  zones: zones.map(z => [z.id, z.minY, z.maxY, z.tileCount, z.encounterCount]) }, null, 1));
