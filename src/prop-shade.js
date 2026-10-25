// Contact shade under the standing props. Each prop's ground footprint (its colliders or its
// package footprint, the same data that places it) becomes a soft caster; the casters are baked
// once per world into one field, and the ground shader reads it in two hard, dithered steps, like
// the actors' 2:1 contact ellipses. Pure data: no GPU work here.
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import { pixelAtlases, PIXELS_PER_UNIT } from './pixel-assets.js';
import { roadPillar } from './road-country.js';

// Field texels per world unit. The shader thresholds the bilinear field, so the steps stay hard.
export const SHADE_PIXELS = 4;
const PACKAGE_FOOTPRINTS = { ...ruins.footprints, ...panorama.footprints };
// Light sources are lit, never shaded: their own pools cover the ground under them.
const LIGHT_SOURCES = new Set(['campfire-base', 'brazier']);

// The ground contact of a healing shrine. Its sprite stands at (x − .5, y − .5); the drawing's
// contact diamond sits above the atlas anchor, which moves it back along the view diagonal.
export function shrineContact(shrine) {
  const atlas = pixelAtlases.monasteryWorld, print = atlas.footprints?.['healing-shrine'];
  const back = print ? Math.SQRT2 * ((atlas.anchor[1] - print.contactCenter[1]) / PIXELS_PER_UNIT + .03 * Math.sin(Math.PI / 3)) : 0;
  return { x: shrine.x - .5 - back, y: shrine.y - .5 - back };
}

// A footprint in world units at a contact point; a mirrored drawing exchanges the x and y extents.
function shape(print, at, scale = 1, flip = false) {
  return print.shape === 'circle' ? { x: at.x, y: at.y, radius: print.radius * scale }
    : { x: at.x, y: at.y, halfWidth: (flip ? print.halfDepth : print.halfWidth) * scale,
      halfDepth: (flip ? print.halfWidth : print.halfDepth) * scale };
}

// A footprint's shade: a circle reaches a little past its edge and leans screen-down, away from
// the art's top-left light; a box is full under its footprint and fades over `reach`.
function caster(footprint, strength = 1) {
  return footprint.radius !== undefined
    ? { x: footprint.x, y: footprint.y + footprint.radius * .12, radius: footprint.radius * 1.2 + .14, strength }
    : { x: footprint.x, y: footprint.y, halfWidth: footprint.halfWidth + .1, halfDepth: footprint.halfDepth + .1, reach: .3, strength };
}

// Shade casters of a world: { x, y, radius, strength } circles and { x, y, halfWidth, halfDepth,
// reach, strength } boxes. `layout` is layoutLandscape's result (the generated scenery and border).
export function propShadeCasters(world, layout = null) {
  const casters = [];
  for (const p of [...(layout?.scenery ?? []), ...(layout?.border ?? [])]) {
    if (p.footprint && p.layer !== 'ground') casters.push(caster(p.footprint));
  }
  for (const zone of world.zones ?? [world]) {
    const v13 = pixelAtlases[zone.id]?.footprints;
    for (const p of zone.setDressing ?? []) {
      if (p.layer === 'ground' || LIGHT_SOURCES.has(p.kind)) continue;
      const print = v13?.[p.kind] ?? PACKAGE_FOOTPRINTS[p.kind];
      // Flat art lies on the ground; low v13 props (graves, fences, benches) stay unshaded.
      if (print?.role === 'flat' || (print?.role === 'low' && !print.tall)) continue;
      const at = p.contact ?? (p.collider?.radius !== undefined ? p.collider : null) ?? p;
      // Authored colliders first: each post of a gate or a pergola casts its own shade.
      const shapes = p.colliders ?? (p.collider ? [p.collider] : print ? [shape(print, at, p.scale, p.flip)] : []);
      for (const footprint of shapes) casters.push(caster(footprint));
      // A broad crown (a yew, an olive) shades the ground around its trunk lightly.
      if (print?.canopy) casters.push({ x: at.x, y: at.y + .25, radius: print.canopy * (p.scale ?? 1), strength: .5 });
    }
    // The road's gameplay pillars wear the camp's ruined pillar (pixel-scene.js).
    if (!zone.setDressing && zone.id === 'road') {
      for (const pillar of zone.pillars ?? []) casters.push(caster(roadPillar(pillar).footprint));
    }
    const shrine = pixelAtlases.monasteryWorld.footprints?.['healing-shrine'];
    if (shrine) for (const s of zone.shrines ?? []) casters.push(caster(shape(shrine, shrineContact(s))));
  }
  return casters;
}

const reachOf = c => c.radius ?? Math.max(c.halfWidth, c.halfDepth) + c.reach;

// The casters' field, one byte per texel: { data, width, height, bounds: [x, y, width, height] }
// in world units, or null without casters. The width is a multiple of 4 (byte row alignment).
export function bakePropShade(casters, pixelsPerUnit = SHADE_PIXELS) {
  if (!casters.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of casters) {
    const reach = reachOf(c);
    minX = Math.min(minX, c.x - reach); maxX = Math.max(maxX, c.x + reach);
    minY = Math.min(minY, c.y - reach); maxY = Math.max(maxY, c.y + reach);
  }
  minX = Math.floor(minX) - 1; minY = Math.floor(minY) - 1;
  const width = Math.ceil((Math.ceil(maxX) + 1 - minX) * pixelsPerUnit / 4) * 4;
  const height = Math.ceil((Math.ceil(maxY) + 1 - minY) * pixelsPerUnit);
  const field = new Float32Array(width * height);
  for (const c of casters) {
    const reach = reachOf(c);
    const x0 = Math.max(0, Math.floor((c.x - reach - minX) * pixelsPerUnit));
    const x1 = Math.min(width - 1, Math.ceil((c.x + reach - minX) * pixelsPerUnit));
    const y0 = Math.max(0, Math.floor((c.y - reach - minY) * pixelsPerUnit));
    const y1 = Math.min(height - 1, Math.ceil((c.y + reach - minY) * pixelsPerUnit));
    for (let row = y0; row <= y1; row++) {
      const wy = minY + (row + .5) / pixelsPerUnit;
      for (let column = x0; column <= x1; column++) {
        const wx = minX + (column + .5) / pixelsPerUnit;
        const d = c.radius !== undefined ? Math.hypot(wx - c.x, wy - c.y) / c.radius
          : .62 + Math.hypot(Math.max(0, Math.abs(wx - c.x) - c.halfWidth), Math.max(0, Math.abs(wy - c.y) - c.halfDepth)) / c.reach * .38;
        if (d >= 1) continue;
        const value = (1 - d * d) * c.strength, i = row * width + column, old = field[i];
        // Overlapping shade deepens a little, never past one.
        field[i] = Math.min(1, Math.max(old, value) + Math.min(old, value) * .25);
      }
    }
  }
  const data = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) data[i] = Math.round(field[i] * 255);
  return { data, width, height, bounds: [minX, minY, width / pixelsPerUnit, height / pixelsPerUnit] };
}
