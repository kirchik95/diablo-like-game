import { Vector2, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { isWalkable } from './world.js';
import { countryZoneLookup } from './country-zones.js';
import { horizonAt } from './camp-layout.js';

const key = (x, y) => `${x},${y}`;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash(x, y, salt) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, size, salt) {
  const u = x / size, v = y / size, ix = Math.floor(u), iy = Math.floor(v);
  const sx = smooth(0, 1, u - ix), sy = smooth(0, 1, v - iy);
  return mix(mix(hash(ix, iy, salt), hash(ix + 1, iy, salt), sx),
    mix(hash(ix, iy + 1, salt), hash(ix + 1, iy + 1, salt), sx), sy);
}

// Signed distance to a closed outline of [x, y] points, negative inside.
function polygonDistance(points, x, y) {
  let distance = Infinity, inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return inside ? -distance : distance;
}

// The camp area and its north-east horizon, from either the union or the camp itself.
export function campBackdrop(world) {
  return (world.zones?.find(zone => zone.id === 'camp') ?? (world.id === 'camp' ? world : null))?.backdrop ?? null;
}

// Signed distance to the paving outline, sampled before any rendering grid.
// Both the inside and outside are represented: a wide path stays fully worn,
// while a one-cell branch has the same rounded, irregular edge as its parent.
function wearField(world, extent) {
  const padding = 4, x0 = extent.minX - padding, y0 = extent.minY - padding;
  const width = extent.maxX - x0 + padding + 1, height = extent.maxY - y0 + padding + 1;
  const paving = new Set((world.paving ?? world.tiles).map(p => key(p.x, p.y)));
  const field = new Float32Array(width * height);
  const camp = world.zones?.find(zone => zone.id === 'camp') ?? (world.id === 'camp' ? world : null);
  const clearings = camp ? [
    ...(camp.braziers ?? []).map(p => ({ ...p, radius: 2.5 })),
    ...[camp.spawn, camp.reward].filter(Boolean).map(p => ({ ...p, radius: 1.5 })),
    ...(camp.setDressing ?? []).filter(p => ['tent-left', 'tent-right', 'supply-cache'].includes(p.kind))
      .map(p => ({ ...p.collider, radius: Math.max(p.collider.halfWidth, p.collider.halfDepth) + .5 })),
  ] : [];
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const x = x0 + column, y = y0 + row, inside = paving.has(key(x, y));
    let distance = 3;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (paving.has(key(x + dx, y + dy)) !== inside) distance = Math.min(distance, Math.hypot(dx, dy) - .5);
    }
    distance *= inside ? -1 : 1;
    field[row * width + column] = distance;
  }
  // Stamp only each clearing's bounded neighborhood, never all props for
  // every sample of the full-map mask.
  // The packed-earth clearing is an authored polygon; stamp its signed
  // distance over its own bounded neighborhood like the round clearings.
  const outline = camp?.clearing ?? [];
  if (outline.length) {
    const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
    const left = Math.max(0, Math.ceil(Math.min(...xs) - 3 - x0)), right = Math.min(width - 1, Math.floor(Math.max(...xs) + 3 - x0));
    const top = Math.max(0, Math.ceil(Math.min(...ys) - 3 - y0)), bottom = Math.min(height - 1, Math.floor(Math.max(...ys) + 3 - y0));
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
      const i = row * width + column;
      field[i] = Math.min(field[i], polygonDistance(outline, x0 + column, y0 + row));
    }
  }
  for (const p of clearings) {
    const reach = p.radius + 3;
    const left = Math.max(0, Math.ceil(p.x - reach - x0)), right = Math.min(width - 1, Math.floor(p.x + reach - x0));
    const top = Math.max(0, Math.ceil(p.y - reach - y0)), bottom = Math.min(height - 1, Math.floor(p.y + reach - y0));
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
      const i = row * width + column;
      field[i] = Math.min(field[i], Math.hypot(x0 + column - p.x, y0 + row - p.y) - p.radius);
    }
  }
  return (x, y) => {
    const u = Math.max(0, Math.min(width - 1.001, x - x0)), v = Math.max(0, Math.min(height - 1.001, y - y0));
    const ix = Math.floor(u), iy = Math.floor(v), i = iy * width + ix;
    return mix(mix(field[i], field[i + 1], u - ix), mix(field[i + width], field[i + width + 1], u - ix), v - iy);
  };
}

export function countrySurfaceMap(world, extent) {
  const pixelsPerUnit = 8, origin = { x: extent.minX - .5, y: extent.minY - .5 };
  const width = (extent.maxX - extent.minX + 1) * pixelsPerUnit;
  const height = (extent.maxY - extent.minY + 1) * pixelsPerUnit;
  const data = new Uint8Array(width * height * 4), wear = wearField(world, extent);
  const court = world.zones?.find(zone => zone.id === 'courtyard');
  const courtEdge = court ? Math.max(...court.tiles.map(p => p.y)) + .5 : 0;
  const camp = world.zones?.find(zone => zone.id === 'camp');
  const campEdge = camp ? Math.min(...camp.tiles.map(p => p.y)) - .5 : 0;
  for (let row = 0; row < height; row++) {
    const y = origin.y + (row + .5) / pixelsPerUnit;
    // Blend the region's stone into the shared path over six world units. The
    // same world-space noise and wear field continue through both area seams.
    const courtWeight = court ? 1 - smooth(courtEdge - 3, courtEdge + 3, y) : Number(world.id === 'courtyard');
    for (let column = 0; column < width; column++) {
      const x = origin.x + (column + .5) / pixelsPerUnit;
      // Low-frequency warping breaks the grid silhouette, with just enough finer
      // variation to leave pixel-scale tufts at the edge instead of smooth blur.
      const wx = x + (noise(x, y, 5, 31) - .5) * .9 + (noise(x, y, 1.4, 32) - .5) * .22;
      const wy = y + (noise(x, y, 5, 33) - .5) * .9 + (noise(x, y, 1.4, 34) - .5) * .22;
      const worn = 1 - smooth(-.35, .55, wear(wx, wy));
      const broad = noise(x, y, 9, 40) * .8 + noise(x, y, 3, 41) * .2;
      // Alpha selects the camp's own meadow and packed earth. It fades over
      // a warped band across the seam, so the shared route stays continuous;
      // the shader interleaves both meadows in patches across the band.
      const campWeight = camp ? smooth(campEdge - 4.9, campEdge + 4.5, wy + (noise(x, y, 3, 35) - .5) * 2)
        : Number(world.id === 'camp');
      // The camp meadow is unbroken grass; bare earth stays on worn ground.
      const soilPatch = smooth(.58, .78, broad) * .9 * (1 - .8 * campWeight);
      const stone = courtWeight * Math.max(smooth(.34, .72, broad) * .7, worn * .78);
      const soil = mix(Math.max(worn, soilPatch), (1 - stone) * Math.max(.3, soilPatch), courtWeight);
      // Stone keeps four blend steps. Soil is stored finely: the shader turns
      // its share into a hard, dithered grass/earth edge, never a blend.
      // Encode all three weights with an exact sum of 255.
      const b = Math.round(stone * 4) / 4, g = Math.min(1 - b, Math.round(soil * 32) / 32);
      const i = (row * width + column) * 4;
      data[i + 2] = Math.round(b * 255); data[i + 1] = Math.min(255 - data[i + 2], Math.round(g * 255));
      data[i] = 255 - data[i + 1] - data[i + 2]; data[i + 3] = Math.round(campWeight * 255);
    }
  }
  return { origin, width, height, pixelsPerUnit, data };
}

function surfaceAt(map, x, y) {
  const column = Math.floor((x - map.origin.x) * map.pixelsPerUnit), row = Math.floor((y - map.origin.y) * map.pixelsPerUnit);
  return map.data.subarray((row * map.width + column) * 4, (row * map.width + column) * 4 + 3);
}

function nearbyPoints(points, radius) {
  const buckets = new Map();
  for (const p of points) {
    const id = key(Math.floor(p.x / radius), Math.floor(p.y / radius));
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(p);
  }
  return (x, y) => {
    const bx = Math.floor(x / radius), by = Math.floor(y / radius);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (buckets.get(key(bx + dx, by + dy))?.some(p => Math.hypot(x - p.x, y - p.y) < radius)) return true;
    }
    return false;
  };
}

export function countryGroundCover(world, bounds, surfaceMap) {
  const zoneAt = countryZoneLookup(world);
  const clear = [...(world.portals ?? []), ...(world.pillars ?? []), ...(world.encounters ?? []), ...(world.braziers ?? []),
    world.shrine, world.secret, world.ritual, world.reward, world.spawn, ...Object.values(world.entries ?? {})].filter(Boolean);
  const nearPaving = nearbyPoints(world.paving ?? world.tiles, 1.8), nearReserved = nearbyPoints(clear, 2.2);
  // Walkable ground art such as the camp rug keeps its surface free of tufts.
  const camp = world.zones?.find(zone => zone.id === 'camp') ?? (world.id === 'camp' ? world : null);
  const rugs = (camp?.setDressing ?? []).filter(p => p.area);
  const onRug = (x, y) => rugs.some(p => Math.abs(x - p.contact.x) < p.area.halfWidth + .4 && Math.abs(y - p.contact.y) < p.area.halfDepth + .4);
  const result = [];
  // Candidate centers occupy coarse world-space cells, not gameplay tiles.
  // Every accepted group has at least two survivors after reservation checks.
  for (let y = Math.floor(bounds.minY / 3) * 3; y <= bounds.maxY; y += 3) {
    for (let x = Math.floor(bounds.minX / 3) * 3; x <= bounds.maxX; x += 3) {
      if (hash(x, y, 60) < .2) continue;
      const cx = x + (hash(x, y, 61) - .5) * 2, cy = y + (hash(x, y, 62) - .5) * 2;
      const cluster = key(x, y), group = [];
      const count = 2 + Math.floor(hash(x, y, 63) * 3);
      for (let i = 0; i < count; i++) {
        const angle = hash(x + i, y, 64) * Math.PI * 2, radius = i ? .45 + hash(x, y + i, 65) * .4 : 0;
        const px = Math.round((cx + Math.cos(angle) * radius) * 16) / 16;
        const py = Math.round((cy + Math.sin(angle) * radius) * 16) / 16;
        if (nearPaving(px, py) || nearReserved(px, py) || onRug(px, py) || !isWalkable(px, py, .4, world)) continue;
        if (group.some(p => Math.hypot(p.x - px, p.y - py) < .42)) continue;
        const grass = surfaceAt(surfaceMap, px, py)[0] > 127;
        const choice = hash(x + i, y - i, 66);
        const family = grass ? ['grass-low', 'grass-wide', 'fern-low', 'flowers-white', 'flowers-ochre']
          : ['leaves', 'twigs', 'pebbles-flat'];
        // One accent per vegetation group; the companions read as a clump.
        const frame = grass && i ? family[Math.floor(choice * 3)] : family[Math.floor(choice * family.length)];
        group.push({ frame, category: grass ? 'vegetation' : 'traces', x: px, y: py, height: 0,
          flip: hash(x + i, y, 67) > .5, cluster });
      }
      if (group.length > 1) result.push(...group);
    }
  }
  // Flat, low-contrast traces may cross worn paving on wide open ground.
  // Keep the same reserved approaches, but give stone courtyards a few small
  // groups even where vegetation would obstruct the path's visual center.
  const nearDetail = nearbyPoints(result, .85);
  const traceFrames = ['leaves', 'twigs', 'pebbles-flat'];
  for (let y = Math.floor(bounds.minY / 3) * 3 + 1.5; y <= bounds.maxY; y += 3) {
    for (let x = Math.floor(bounds.minX / 3) * 3 + 1.5; x <= bounds.maxX; x += 3) {
      const zone = zoneAt(x, y).id;
      const traceThreshold = zone === 'courtyard' ? .15 : zone === 'road' ? .65 : .55;
      if (hash(x, y, 70) < traceThreshold) continue;
      const cx = x + (hash(x, y, 71) - .5) * .6, cy = y + (hash(x, y, 72) - .5) * .6;
      const group = [], cluster = `traces:${key(x, y)}`;
      const count = 2 + Math.floor(hash(x, y, 73) * 2);
      for (let i = 0; i < count; i++) {
        const angle = hash(x, y, 74) * Math.PI * 2 + i * Math.PI * 2 / count;
        const px = Math.round((cx + Math.cos(angle) * .5) * 16) / 16;
        const py = Math.round((cy + Math.sin(angle) * .5) * 16) / 16;
        if (nearReserved(px, py) || nearDetail(px, py) || onRug(px, py) || !isWalkable(px, py, .7, world) ||
          surfaceAt(surfaceMap, px, py)[0] > 127) continue;
        group.push({ frame: traceFrames[Math.floor(hash(x + i, y, 75) * traceFrames.length)], category: 'traces',
          x: px, y: py, height: 0, flip: hash(x, y + i, 76) > .5, cluster });
      }
      if (group.length > 1) result.push(...group);
    }
  }
  return result;
}

// Native backdrop density and the horizon lookup range in screen units.
const BACKDROP_PIXELS = 32, HORIZON_RANGE = [-64, 0];

function horizonTexture(scene, backdrop, frame) {
  const width = Math.round(frame.width * BACKDROP_PIXELS), data = new Uint8Array(width * 4);
  for (let column = 0; column < width; column++) {
    const v = horizonAt(backdrop.horizon, frame.u0 + (column + .5) / BACKDROP_PIXELS);
    const n = Math.round(Math.max(0, Math.min(1, (v - HORIZON_RANGE[0]) / (HORIZON_RANGE[1] - HORIZON_RANGE[0]))) * 65535);
    data.set([n >> 8, n & 255, 0, 255], column * 4);
  }
  const texture = RawTexture.CreateRGBATexture(data, width, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  texture.name = 'camp-horizon';
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.metadata = { data, frame, range: HORIZON_RANGE, pixelsPerUnit: BACKDROP_PIXELS };
  return texture;
}

export function countryGroundMaterial(scene, assets, map, world = {}) {
  const mask = RawTexture.CreateRGBATexture(map.data, map.width, map.height, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  mask.name = 'country-surface-mask';
  const backdrop = campBackdrop(world), art = assets.campBackdrop;
  const frame = art?.screenFrame ?? { u0: -20, v0: -40, width: 64, height: 40 };
  const material = new ShaderMaterial('country-ground', scene, {
    vertexSource: `precision highp float;
      attribute vec3 position;
      uniform mat4 world;
      uniform mat4 view;
      uniform mat4 worldViewProjection;
      uniform vec4 backdropView;
      varying vec3 groundPosition;
      varying vec2 screenPosition;
      varying vec2 backdropPosition;
      void main(void) {
        groundPosition = (world * vec4(position, 1.0)).xyz;
        // Screen units of the fixed camera: u right, v down, for flat ground.
        screenPosition = vec2(groundPosition.z - groundPosition.x, (groundPosition.x + groundPosition.z) * .5) * .70710678;
        // The far mountains move slower than the ground around the view centre.
        vec4 eye = view * vec4(groundPosition, 1.0);
        vec2 centre = screenPosition - vec2(eye.x, -eye.y);
        backdropPosition = screenPosition - backdropView.x * (centre - backdropView.yz);
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }`,
    fragmentSource: `precision highp float;
      varying vec3 groundPosition;
      varying vec2 screenPosition;
      varying vec2 backdropPosition;
      uniform vec4 maskBounds;
      uniform vec2 maskSize;
      uniform vec4 horizonFrame;
      uniform vec4 backdropFrame;
      uniform float backdropEnabled;
      uniform vec4 fireGlow;
      uniform vec4 campSeam;
      uniform sampler2D surfaceMask;
      uniform sampler2D grassTexture;
      uniform sampler2D soilTexture;
      uniform sampler2D stoneTexture;
      uniform sampler2D campGrassTexture;
      uniform sampler2D campEarthTexture;
      uniform sampler2D horizonTexture;
      uniform sampler2D backdropTexture;
      float hash12(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // The mask texture stays nearest-sampled; weights are interpolated here.
      vec4 maskAt(vec2 world) {
        vec2 t = (world - maskBounds.xy) / maskBounds.zw * maskSize - .5, i = floor(t), f = t - i;
        vec4 a = texture2D(surfaceMask, (i + vec2(.5, .5)) / maskSize), b = texture2D(surfaceMask, (i + vec2(1.5, .5)) / maskSize);
        vec4 c = texture2D(surfaceMask, (i + vec2(.5, 1.5)) / maskSize), d = texture2D(surfaceMask, (i + vec2(1.5, 1.5)) / maskSize);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float luma(vec3 c) { return dot(c, vec3(.3, .59, .11)); }
      // Above .5 the pixel is earth. World clumps scallop the edge, a per-pixel
      // hash dithers it, and bright grass blades reach over onto the earth.
      float earthAt(vec2 world, vec2 pixel, vec4 w, float blade) {
        float share = w.g / max(w.r + w.g, .001);
        float clump = valueNoise(world * 2.6) * .6 + valueNoise(world * 7.0 + 13.0) * .4;
        return share + (clump - .5) * .42 + (hash12(pixel) - .5) * .2 - blade;
      }
      vec3 meadow(vec2 uv, float campSelect) {
        return campSelect > .5 ? texture2D(campGrassTexture, uv).rgb : texture2D(grassTexture, uv).rgb;
      }
      void main(void) {
        float lip = 1.0;
        if (backdropEnabled > .5) {
          vec4 h = texture2D(horizonTexture, vec2((screenPosition.x - horizonFrame.x) / horizonFrame.y, .5));
          float horizon = horizonFrame.z + (h.r * 65280.0 + h.g * 255.0) / 65535.0 * horizonFrame.w;
          if (screenPosition.y < horizon) {
            vec2 q = (backdropPosition - backdropFrame.xy) / backdropFrame.zw;
            gl_FragColor = vec4(texture2D(backdropTexture, vec2(q.x, 1.0 - clamp(q.y, .0005, .9995))).rgb, 1.0);
            return;
          }
          // One dark framebuffer row marks where the plateau drops away.
          if (screenPosition.y - horizon < .0375) lip = .5;
        }
        vec2 world = groundPosition.xz, uv = world / 4.0;
        // World-fixed screen pixels: dither that never swims with the camera.
        vec2 pixel = floor(screenPosition * 32.0);
        vec4 weights = maskAt(world);
        // Across the seam the camp meadow and the road meadow interleave in patches.
        float patchy = valueNoise(world * .7) * .75 + hash12(pixel + 17.0) * .25;
        float campSelect = step(.5, weights.a + (patchy - .5) * .9);
        // Near the camp the road country takes the camp's olive grade.
        float grade = campSeam.w * smoothstep(campSeam.x - campSeam.y, campSeam.x, world.y) * (1.0 - weights.a);
        vec3 grass = meadow(uv, campSelect);
        if (campSelect < .5) grass *= mix(vec3(1.0), vec3(.94, .84, .76), grade);
        vec3 soil = mix(texture2D(soilTexture, uv).rgb * mix(vec3(1.0), vec3(1.3, 1.26, 1.18), grade),
          texture2D(campEarthTexture, uv).rgb, weights.a);
        // Camp meadow: broad darker patches, a few dry ones and sparse flowers.
        float camp = campSelect;
        float patches = valueNoise(world * .33) * .65 + valueNoise(world * .9 + 7.0) * .35 + (hash12(pixel + 3.0) - .5) * .05;
        if (patches > .63) grass = mix(grass, grass * vec3(.82, .86, .9), camp);
        else if (patches < .3) grass = mix(grass, grass * vec3(1.08, 1.06, .95), camp);
        // Flowers gather in a few small meadow patches, never as even speckle.
        float bloom = smoothstep(.74, .9, valueNoise(world * .45 + 31.0));
        if (hash12(pixel + 91.0) < bloom * .05 * camp)
          grass = hash12(pixel + 5.0) < .62 ? vec3(.88, .86, .76) : vec3(.86, .72, .38);
        float blade = max(0.0, luma(grass) - .45) * 2.5;
        vec3 color = grass;
        if (earthAt(world, pixel, weights, blade) > .5) {
          color = soil;
          // Grass overhanging the earth one pixel above casts a thin shadow.
          vec2 above = world - vec2(.0442);
          float bladeAbove = max(0.0, luma(meadow(above / 4.0, campSelect)) - .45) * 2.5;
          if (earthAt(above, pixel - vec2(0.0, 1.0), maskAt(above), bladeAbove) <= .5) color *= .8;
        }
        color = mix(color, texture2D(stoneTexture, uv).rgb, weights.b);
        // Campfire light on the packed earth: three hard steps, no gradient.
        float glow = floor(clamp(1.0 - length(world - fireGlow.xy) / fireGlow.z, 0.0, 1.0) * 3.0 + .35) / 3.0;
        color = mix(color, color * vec3(1.3, 1.08, .8) + vec3(.05, .025, 0.0), glow * fireGlow.w);
        gl_FragColor = vec4(color * lip, 1.0);
      }`,
  }, { attributes: ['position'],
    uniforms: ['world', 'view', 'worldViewProjection', 'maskBounds', 'maskSize', 'horizonFrame', 'backdropFrame', 'backdropView',
      'backdropEnabled', 'fireGlow', 'campSeam'],
    samplers: ['surfaceMask', 'grassTexture', 'soilTexture', 'stoneTexture', 'campGrassTexture', 'campEarthTexture',
      'horizonTexture', 'backdropTexture'] });
  material.backFaceCulling = false;
  material.setVector4('maskBounds', new Vector4(map.origin.x, map.origin.y, map.width / map.pixelsPerUnit, map.height / map.pixelsPerUnit));
  material.setVector2('maskSize', new Vector2(map.width, map.height));
  material.setTexture('surfaceMask', mask);
  material.setTexture('grassTexture', assets.countryGrass.texture);
  material.setTexture('soilTexture', assets.countrySoil.texture);
  material.setTexture('stoneTexture', assets.countryStone.texture);
  material.setTexture('campGrassTexture', (assets.campGrass ?? assets.countryGrass).texture);
  material.setTexture('campEarthTexture', (assets.campEarth ?? assets.countrySoil).texture);
  const enabled = !!(backdrop && art);
  // Only the camp fire lights the ground, around its stone ring's centre.
  const fire = (world.zones ?? [world]).flatMap(zone => zone.setDressing ?? []).find(p => p.kind === 'campfire-base')?.collider;
  material.setVector4('fireGlow', fire ? new Vector4(fire.x, fire.y, 3.4, .7) : new Vector4(0, 0, 1, 0));
  // The road country grades toward the camp meadow over 22u before its seam.
  const camp = world.zones?.find(zone => zone.id === 'camp');
  const seam = camp ? Math.min(...camp.tiles.map(p => p.y)) - .5 : 0;
  material.setVector4('campSeam', new Vector4(seam, 22, 0, camp ? .85 : 0));
  material.setFloat('backdropEnabled', Number(enabled));
  material.setVector4('horizonFrame', new Vector4(frame.u0, frame.width, HORIZON_RANGE[0], HORIZON_RANGE[1] - HORIZON_RANGE[0]));
  material.setVector4('backdropFrame', new Vector4(frame.u0, frame.v0, frame.width, frame.height));
  material.setVector4('backdropView', new Vector4(backdrop?.parallax ?? 0, ...(backdrop?.reference ?? [0, 0]), 0));
  // Samplers are always bound; without a backdrop the lookup is never used.
  const horizon = enabled ? horizonTexture(scene, backdrop, frame) : null;
  material.setTexture('horizonTexture', horizon ?? mask);
  material.setTexture('backdropTexture', (art ?? assets.countryStone).texture);
  material.metadata = { surface: 'country', surfaceMap: map, backdrop: enabled ? backdrop : null, horizon: horizon?.metadata ?? null };
  return material;
}
