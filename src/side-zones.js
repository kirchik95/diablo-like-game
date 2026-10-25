// Side zones beside the spine (camp, road, courtyard): the old cemetery east of the road and the
// monastery orchard west of the courtyard. Data only, in world coordinates: a zone owns every
// cell, prop and zone name whose point lies inside its area box (docs/design/world-expansion.md).
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// offset: local layout coordinates to world. area: the ownership box, checked before the spine's
// y bands.
export const SIDE_ZONES = freeze({
  cemetery: { offset: { x: 28, y: -68 }, area: { minX: 14.5, maxX: Infinity, minY: -99.5, maxY: -41.5 } },
  orchard: { offset: { x: -28, y: -120 }, area: { minX: -Infinity, maxX: -13.5, minY: -Infinity, maxY: -99.5 } },
});
export const inSideArea = (area, x, y) => x >= area.minX && x < area.maxX && y >= area.minY && y < area.maxY;
export function sideZoneAt(x, y) {
  for (const [id, zone] of Object.entries(SIDE_ZONES)) if (inSideArea(zone.area, x, y)) return id;
  return null;
}

// The spine cells that lead into a side zone, [x0, x1, y0, y1]: the road's spur to the cemetery
// gate and the breach in the courtyard's west wall.
export const SIDE_LINKS = freeze({ cemetery: [10, 14, -66, -64], orchard: [-13, -13, -119, -116] });

// Integer world walk regions, shared by side-zone dressing and geography tests.
export const SPINE_WALK = freeze([
  [-4, 4, -52, -42], [-9, 9, -66, -51], [-4, 4, -74, -65], [-9, 9, -88, -72], [-4, 4, -99, -86],
  [-20, -7, -66, -58], [-27, -15, -78, -58], [-17, -7, -78, -71], SIDE_LINKS.cemetery,
  [-12, 12, -136, -108], [-4, 4, -107, -100], SIDE_LINKS.orchard,
]);
