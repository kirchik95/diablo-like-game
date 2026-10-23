// Path lengths on the real collision world (radius .23, as in overworld.test.js).
import { writeFileSync } from 'node:fs';
import { OVERWORLD } from '../../../../src/overworld.js';
import { findPath, clearLine } from '../../../../src/world.js';
import { layoutLandscape } from '../../../../src/landscape.js';

const length = (from, path) => path.reduce((s, p, i) => s + Math.hypot(p.x - (i ? path[i - 1] : from).x, p.y - (i ? path[i - 1] : from).y), 0);
const routes = {};
for (const [id, a, b] of [['spawn-ritual', OVERWORLD.spawn, OVERWORLD.ritual], ['spawn-shrine', OVERWORLD.spawn, OVERWORLD.shrine],
  ['spawn-secret', OVERWORLD.spawn, OVERWORLD.secret], ['ritual-reward', OVERWORLD.ritual, OVERWORLD.reward]]) {
  const path = findPath(a, b, .23, OVERWORLD);
  routes[id] = { from: a, to: b, nodes: path.length, length: Math.round(length(a, path) * 10) / 10,
    secondsAt4_4: Math.round(length(a, path) / 4.4 * 10) / 10 };
}
const enc = OVERWORLD.encounters, packs = [...new Set(enc.map(e => e.packId))];
const gaps = [];
for (let i = 0; i < packs.length; i++) for (let j = i + 1; j < packs.length; j++) {
  let best = Infinity;
  for (const a of enc.filter(e => e.packId === packs[i])) for (const b of enc.filter(e => e.packId === packs[j])) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
  gaps.push({ a: packs[i], b: packs[j], nearest: Math.round(best * 100) / 100 });
}
gaps.sort((a, b) => a.nearest - b.nearest);
const nearestToCamp = Math.min(...enc.map(e => OVERWORLD.safeArea.minY - e.y));
const land = layoutLandscape(OVERWORLD);
const metrics = { routes, packGapsNearestFirst: gaps.slice(0, 6), minPackGap: gaps[0].nearest,
  nearestEnemyBeyondSafeEdge: nearestToCamp, mainAxisClear: clearLine({ x: 0, y: -24 }, { x: 0, y: -91 }, .29, OVERWORLD),
  groundCoverSample: land.groundCover.slice(0, 2), groundCoverCount: land.groundCover.length };
writeFileSync(new URL('route-metrics.json', import.meta.url), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify(metrics, null, 1));
