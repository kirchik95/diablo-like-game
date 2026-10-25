import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { countrySurfaceMap, countryGroundCover, countryGroundMaterial, campBackdrop } from './country-terrain.js';
import { inBackdrop } from './camp-layout.js';
import { createCountryBorder, proceduralZone } from './country-border.js';
import { countryZoneLookup } from './country-zones.js';
import { layoutRoadCountry, panoramaFootprint } from './road-country.js';
import { propShadeCasters, bakePropShade } from './prop-shade.js';

const key = (x, y) => `${x},${y}`;
const noise = (x, y, salt = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
// Covers the largest native frustum, follow interpolation and impact shake.
const LANDSCAPE_MARGIN = 40;

export function layoutLandscape(world) {
  const tiles = [...world.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  const bounds = {
    minX: Math.min(...tiles.map(p => p.x)), maxX: Math.max(...tiles.map(p => p.x)),
    minY: Math.min(...tiles.map(p => p.y)), maxY: Math.max(...tiles.map(p => p.y)),
  };
  const extent = { minX: bounds.minX - LANDSCAPE_MARGIN, maxX: bounds.maxX + LANDSCAPE_MARGIN,
    minY: bounds.minY - LANDSCAPE_MARGIN, maxY: bounds.maxY + LANDSCAPE_MARGIN };
  const walk = new Set(tiles.map(p => key(p.x, p.y)));
  const distance = new Map(tiles.map(p => [key(p.x, p.y), 0]));
  const queue = tiles.slice();
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], next = distance.get(key(p.x, p.y)) + 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx, y = p.y + dy, id = key(x, y);
      if (x < extent.minX || x > extent.maxX || y < extent.minY || y > extent.maxY || distance.has(id)) continue;
      distance.set(id, next); queue.push({ x, y });
    }
  }
  const zoneAt = countryZoneLookup(world);
  const cells = new Map();
  for (let y = extent.minY; y <= extent.maxY; y++) for (let x = extent.minX; x <= extent.maxX; x++) {
    const id = key(x, y);
    cells.set(id, { x, y, walkable: walk.has(id), height: 0, surface: 'country' });
  }
  const boundary = [];
  for (const p of tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!walk.has(key(p.x + dx, p.y + dy))) boundary.push({ x: p.x, y: p.y, dx, dy });
  }
  const border = createCountryBorder(world, boundary, walk);
  const surfaceMap = countrySurfaceMap(world, extent);
  const groundCover = countryGroundCover(world, bounds, surfaceMap);
  const scenery = [];
  const reserved = [...(world.portals ?? []), world.shrine, world.secret, world.ritual, world.reward].filter(Boolean);
  const backdrop = campBackdrop(world);
  const allowed = (x, y) => {
    // CAMP_LAYOUT owns every camp-area prop, including its rim and outer
    // groves; road-country.js owns the road's. Nothing stands on the far
    // backdrop beyond the horizon.
    if (!proceduralZone(zoneAt(x, y)) || inBackdrop(backdrop, x, y, .3)) return false;
    if ((distance.get(key(Math.round(x), Math.round(y))) ?? 0) < 3) return false;
    return !reserved.some(p => Math.hypot(p.x - x, p.y - y) < 3.5);
  };
  const place = (frame, x, y) => {
    if (!allowed(x, y)) return;
    const cell = cells.get(key(Math.round(x), Math.round(y)));
    const p = border.register(frame, x, y, 1, noise(x, y, 8) > .5);
    if (cell && border.allowScenery(p)) scenery.push(p);
  };
  // Jittered groves and rock groups, not noise on every tile. Sparse outer
  // country is still populated where the ultrawide camera looks off the route.
  for (let y = Math.floor(extent.minY / 6) * 6 + 3; y < extent.maxY; y += 6) {
    for (let x = Math.floor(extent.minX / 6) * 6 + 3; x < extent.maxX; x += 6) {
      if (noise(x, y, 1) < .3) continue;
      const px = x + Math.round((noise(x, y, 2) - .5) * 3), py = y + Math.round((noise(x, y, 4) - .5) * 3);
      if ((distance.get(key(px, py)) ?? 100) > 30) continue;
      const family = ['dead-tree', 'ruin-pile', 'cypress'];
      place(family[Math.floor(noise(x, y, 5) * family.length)], px, py);
      place(noise(x, y, 6) > .5 ? 'rock-small' : 'grass', px + 1, py - 1);
      if (noise(x, y, 7) > .6) place('shrub', px - 1, py - 1);
    }
  }
  // The road in the camp's style. Neighbouring authored props and the v4
  // border only space it; they keep their own placements.
  const authored = (world.zones ?? [world]).filter(zone => zone.id !== 'road').flatMap(zone => zone.setDressing ?? [])
    .map(p => p.collider?.radius !== undefined || p.collider?.halfWidth !== undefined ? p.collider
      : p.contact && panoramaFootprint(p.kind, p.contact.x, p.contact.y, p.scale, p.flip)).filter(Boolean);
  const road = layoutRoadCountry({ world, walk, distance, extent, zoneAt, backdrop, keep: border.allowScenery,
    others: [...authored, ...border.placements.map(p => ({ x: p.contact.x, y: p.contact.y, radius: .5 * p.scale }))] });
  scenery.push(...road.scenery);
  return { bounds, extent, cells, boundary, border: [...border.placements, ...road.border], scenery, groundCover, surfaceMap };
}

function batch() { return { positions: [], indices: [], normals: [], uvs: [] }; }
function quad(group, corners, uvs) {
  const offset = group.positions.length / 3;
  const a = corners[0], b = corners[1], c = corners[2];
  const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...normal);
  for (let i = 0; i < 4; i++) {
    group.positions.push(...corners[i]); group.normals.push(...normal.map(n => n / length)); group.uvs.push(...uvs[i]);
  }
  group.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}
function horizontal(group, x0, x1, y0, y1, height) {
  quad(group, [[x0, height, y0], [x0, height, y1], [x1, height, y1], [x1, height, y0]],
    [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
}
export function buildLandscape(scene, assets, world) {
  const layout = layoutLandscape(world), groups = new Map();
  // The props' contact shade is baked once with the world; its texture belongs to the world build.
  const shade = bakePropShade(propShadeCasters(world, layout));
  const groundMaterial = countryGroundMaterial(scene, assets, layout.surfaceMap, world, shade);
  const group = name => {
    if (!groups.has(name)) groups.set(name, batch());
    return groups.get(name);
  };
  // Keep the submitted walkable footprint for picking/debug consumers, but
  // render both sides of its boundary at exactly zero with the same material.
  const visited = new Set(), { cells, extent } = layout;
  for (let y = extent.minY; y <= extent.maxY; y++) for (let x = extent.minX; x <= extent.maxX; x++) {
    if (visited.has(key(x, y))) continue;
    const p = cells.get(key(x, y));
    const matches = (u, v) => {
      const cell = cells.get(key(u, v));
      return cell && !visited.has(key(u, v)) && cell.walkable === p.walkable;
    };
    let right = x, bottom = y;
    while (matches(right + 1, y)) right++;
    outer: while (bottom < extent.maxY) {
      for (let u = x; u <= right; u++) if (!matches(u, bottom + 1)) break outer;
      bottom++;
    }
    for (let v = y; v <= bottom; v++) for (let u = x; u <= right; u++) visited.add(key(u, v));
    horizontal(group(p.walkable ? 'walkable-ground' : 'outer-ground'), x - .5, right + .5, y - .5, bottom + .5, 0);
  }
  const meshes = [];
  let floor;
  for (const [name, data] of groups) {
    const mesh = new Mesh(name, scene), vertices = new VertexData();
    Object.assign(vertices, data); vertices.applyToMesh(mesh);
    mesh.material = groundMaterial; mesh.isPickable = false;
    mesh.metadata = { landscapeSurface: true, terrain: 'ground' };
    mesh.freezeWorldMatrix(); meshes.push(mesh);
    if (name === 'walkable-ground') floor = mesh;
  }
  return { ...layout, floor, meshes, groundMaterial };
}
