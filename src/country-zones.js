import { inSideArea } from './side-zones.js';

// Areas occupy consecutive north/south bands. Derive the seams once from the
// submitted global tiles; sampling the terrain must never scan all zone tiles.
export function countryZoneLookup(world) {
  if (!world.zones?.length) return () => world;
  // Side zones own their area box (side-zones.js) before the spine's bands.
  const sides = world.zones.filter(zone => zone.area);
  const bands = world.zones.filter(zone => !zone.area).map(zone => ({ zone,
    minY: Math.min(...zone.tiles.map(p => p.y)), maxY: Math.max(...zone.tiles.map(p => p.y)),
  })).sort((a, b) => b.maxY - a.maxY);
  const seams = bands.slice(0, -1).map((band, i) => (band.minY + bands[i + 1].maxY) / 2);
  return (x, y) => sides.find(zone => inSideArea(zone.area, x, y))
    ?? bands[seams.findIndex(seam => y >= seam)]?.zone ?? bands.at(-1).zone;
}
