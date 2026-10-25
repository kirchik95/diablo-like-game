import { setMaterialOpacity, watchMaterialOpacity, watchSpriteOcclusion, scheduleStaticObservation } from './static-sprite-state.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { loadPixelAssets, batchMaterials, createSprite, disposeSprite, setSpriteFrame, setGroundEffectDirection, createShadow, buildPixelWorld,
  SpriteAppearance, loadAppearanceTexture, legacyWorld, pixelAssetUrls, PIXELS_PER_UNIT, cachesOf, shrinesOf,
  createPixelBillboard, itemIconPixels, monkShotPixels, wraithShotPixels, rarityInk,
  layOnGround, lootGroundFrames, groundDrawingOffset, LOOT_GROUND, LOOT_STACK, LevelUpLight, ScenePolish } from './pixel-scene.js';
import { monkPose, houndPose, wraithPose, beetlePose, worldPose, effectPose, PresentationState,
  attackCombo, craneProgress, CRANE_PEAK, touchAimMarker } from './pixel-animation.js';
import { opaqueSpritePixel, obscuresSprite } from './pixel-picking.js';
import { isWalkable, clearLine } from './world.js';
import { WRAITH_TIMINGS, WRAITH_STATS, BEETLE_TIMINGS, BEETLE_STATS } from './campaign.js';
import { appearanceVariant } from './appearance.js';
import { MONK_RULES } from './monk-combat.js';
import { getOverworldZone } from './overworld.js';
import { lootLabelVisible, placeLootLabels, lootLightState, lootDropPose, drawLootLight } from './loot-glow.js';
import { WEAPON_HIT_ATLAS } from './weapon-hit-fx.js';

// HD-2D core: presentation host; the merge-time effect registry starts empty.
import { createHD2D } from './hd2d/index.js';

const TAU = Math.PI * 2;
const CAMERA_VIEW_SCALE = 1.2;
// Asset geometry stays at 32px/u; interaction uses the actual framebuffer projection.
const projectedSpriteScale = (camera, height) =>
  height * camera.viewport.height / ((camera.orthoTop - camera.orthoBottom) * PIXELS_PER_UNIT);
const seeded = n => { const x = Math.sin(n * 127.1 + 73.4) * 43758.5453; return x - Math.floor(x); };
const appearanceUrl = game => game.world ? appearanceVariant(game.appearance).url : pixelAssetUrls.monk;
// Where a body is drawn this frame: blended between its last two simulation steps
// (render-interpolation.js), or the body itself without that history.
const drawnAt = (renderer, body) => renderer.motion?.at(body) ?? body;

// Vector3.set dirties a transform even when the values are unchanged. Contact
// shadows can keep Babylon's matrix/bounds cache; retain signed zero as well.
export function setVectorIfChanged(vector, x, y, z) {
  if (!Object.is(vector.x, x) || !Object.is(vector.y, y) || !Object.is(vector.z, z)) vector.set(x, y, z);
  return vector;
}

// Actor quads keep their local rotation/scale and the camera never turns.
// Keep a snapped pose's native billboard matrix until its position changes.
export function setActorPosition(mesh, x, y, z, cache = true) {
  const p = mesh.position;
  if (!cache) {
    p.set(x, y, z);
    if (mesh.isWorldMatrixFrozen) mesh.unfreezeWorldMatrix();
    return;
  }
  if (!mesh.isWorldMatrixFrozen || !Object.is(p.x, x) || !Object.is(p.y, y) || !Object.is(p.z, z)) {
    p.set(x, y, z);
    mesh.freezeWorldMatrix();
  }
}

const windupDuration = enemy => enemy.kind === 'wraith' ? WRAITH_TIMINGS.windup
  : enemy.kind === 'beetle' ? BEETLE_TIMINGS.windup : .55;

// The fixed camera's screen lattice: whole framebuffer pixels across (u) and down
// (v / 2). The camera and every moving actor snap to it, so nearest-sampled
// sprites keep one sub-pixel phase and their 5:6-scaled art never shimmers.
export function snapToLattice(x, y, pixelsPerUnit) {
  const u = Math.round((y - x) * Math.SQRT1_2 * pixelsPerUnit) / pixelsPerUnit;
  const v = Math.round((y + x) * Math.SQRT1_2 * .5 * pixelsPerUnit) / (.5 * pixelsPerUnit);
  return { x: (v - u) * Math.SQRT1_2, y: (v + u) * Math.SQRT1_2 };
}
const ELEVATION = Math.sin(Math.PI / 3);

// The size of one world pixel (one framebuffer pixel). Desktop counts whole CSS px:
// max(2, floor(min(W / 640, H / 360))). A touch device (coarse pointer) counts whole DEVICE px,
// k = max(2, floor(H_dev / 270)), so a phone shows about as much world as a desktop
// (docs/design/mobile-touch.md §3). Returns CSS px per world pixel (Babylon's hardware scaling
// level), the render size in world pixels and the canvas box in CSS px. Every box edge falls on a
// device pixel, so world pixels stay whole and do not shimmer.
export function worldScale({ width: viewportWidth, height: viewportHeight, dpr = 1, coarse = false }) {
  if (!coarse) {
    const scale = Math.max(2, Math.floor(Math.min(viewportWidth / 640, viewportHeight / 360)));
    const renderWidth = Math.floor(viewportWidth / scale), renderHeight = Math.floor(viewportHeight / scale);
    return { cssPerPixel: scale, renderWidth, renderHeight, box: { width: renderWidth * scale, height: renderHeight * scale,
      left: Math.floor((viewportWidth - renderWidth * scale) / 2), top: Math.floor((viewportHeight - renderHeight * scale) / 2) } };
  }
  const deviceWidth = Math.floor(viewportWidth * dpr), deviceHeight = Math.floor(viewportHeight * dpr);
  const k = Math.max(2, Math.floor(deviceHeight / 270));
  const renderWidth = Math.floor(deviceWidth / k), renderHeight = Math.floor(deviceHeight / k);
  return { cssPerPixel: k / dpr, devicePerPixel: k, renderWidth, renderHeight, box: {
    width: renderWidth * k / dpr, height: renderHeight * k / dpr,
    left: Math.floor((deviceWidth - renderWidth * k) / 2) / dpr, top: Math.floor((deviceHeight - renderHeight * k) / 2) / dpr } };
}
// Drawn anchors sit a quarter pixel right of the lattice. At 1.2 source texels per
// framebuffer pixel, samples then stay at least .1 texel from texel edges, so float
// noise in a scrolling camera cannot flip whole columns of an even-width drawing.
const SAMPLE_BIAS = .25;

// Contact shadow per actor: radius (u), opacity, and the drawn body's measured
// horizontal centre relative to its anchor in source pixels of an unflipped key
// (hound bodies centre at x 44 of the 48 anchor). A hovering spirit casts less.
export const SHADOWS = {
  monk: { radius: .44, alpha: .46, offset: 0 },
  hound: { radius: .5, alpha: .46, offset: -4 },
  wraith: { radius: .34, alpha: .26, offset: 0 },
  beetle: { radius: .62, alpha: .5, offset: 0 },
  ritual: { radius: .7, alpha: .4, offset: 0 },
  shot: { radius: .18, alpha: .3, offset: 0 },
  palm: { radius: .12, alpha: .26, offset: 0 },
  item: { radius: .22, alpha: .4, offset: 0 },
};
// Palms and reflected shots fly at chest height; items rest this many screen pixels up.
const MONK_SHOT_HEIGHT = .55, ITEM_REST = 2, WRAITH_SHOT_HEIGHT = .65;
// A pixel-v12 loot stack lies at the actors' sprite height, so its texels share their sampling phase.
// The beam frames are the 1.2 s drop column (§5.4).
const LOOT_HEIGHT = .025, DROP_COLUMN = 1.2;
// Placeholder technique and loot colours from the HUD tokens (styles.css).
const SPIRIT = '#6dd6cb', SPIRIT_LIGHT = '#c2f0dd', CORAL = '#ef8e83', CORAL_LIGHT = '#f8c4ab', AMBER = '#e5b66e';
// Touch aiming (mobile-touch §8): --night outline, --ivory target corners, --muted for «Отмена».
const NIGHT = '#0d0a14', IVORY = '#eee0ce', MUTED = '#b4aaba', TOUCH_LINE_START = .4;
// The wraith's cast magenta (pixel-v3 wraith.png) for its shots and telegraph: enemies alone wear magenta.
// The warning art is already pink-magenta; the tint lowers its red toward the wraith's hue.
const WRAITH_INK = '#f254f2', WRAITH_LIGHT = '#ff81f4', WRAITH_RGB = '242,84,242';
export const WRAITH_WARNING_TINT = Object.freeze([.7, 1, 1]);
// Events Renderer.drawTechniqueEffect draws.
const TECHNIQUE_EFFECTS = new Set(['palm', 'crane', 'deflect', 'deflect-success', 'deflect-whiff', 'shot-fade', 'shot-destroyed',
  'palm-burst', 'relic-chain', 'loot-drop', 'loot-pickup', 'last-breath']);

// Contact records and mask bounds are allocated during boot, then reused for the whole run.
const CELL = 96, FRAMES = 6, DIRECTIONS = 8, CAPACITY = 96;
const LIGHT_LIFE = [.23, .14, .25], HEAVY_LIFE = [.29, .18, .3];
const HIT_SCALE = [1.15, 1.75, 1.8], HEAVY_HIT_SCALE = [1.4, 2.05, 2.1];
const HIT_ATLASES = ['hound', 'wraith', 'beetle', 'monasteryWorld'];
const contact = e => e.source === 'combo' && (e.type === 'impact' || e.type === 'block');

export class WeaponHitFx {
  constructor(image = null, atlases = null) {
    this.image = image;
    if (!image && globalThis.Image) {
      this.image = new Image();
      this.image.src = WEAPON_HIT_ATLAS;
    }
    this.slots = Array.from({ length: CAPACITY }, () => ({ event: null, row: 0, life: 0, family: 0,
      x: 0, y: 0, height: 0, offsetX: 0, offsetY: 0, scale: 1 }));
    this.silhouettes = [];
    for (let i = 0; i < HIT_ATLASES.length; i++) {
      const atlas = atlases?.[HIT_ATLASES[i]];
      if (atlas?.cell) this.silhouettes.push({ atlas, mask: null, bounds: new Uint16Array(atlas.columns * atlas.rows * 4) });
    }
  }

  // Masks arrive during loading. Scan each atlas once before play; the buffers already exist.
  prepare() {
    for (let i = 0; i < this.silhouettes.length; i++) {
      const cache = this.silhouettes[i], a = cache.atlas, mask = a.mask;
      if (!mask || cache.mask === mask) continue;
      const cell = a.cell;
      for (let f = 0; f < a.columns * a.rows; f++) {
        let left = cell, top = cell, right = 0, bottom = 0;
        const column = (f % a.columns) * cell, row = Math.floor(f / a.columns) * cell;
        for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
          const pixel = (row + y) * mask.width + column + x;
          if (!(mask.bytes[pixel >> 3] & (1 << (pixel & 7)))) continue;
          if (x < left) left = x; if (x + 1 > right) right = x + 1;
          if (y < top) top = y; if (y + 1 > bottom) bottom = y + 1;
        }
        const o = f * 4;
        cache.bounds[o] = left; cache.bounds[o + 1] = top;
        cache.bounds[o + 2] = right; cache.bounds[o + 3] = bottom;
      }
      cache.mask = mask;
    }
  }

  replaces(event) {
    return event.type === 'impact' && contact(event) && !!this.image?.complete && this.image.naturalWidth > 0;
  }

  sync(effects, game, views = null, weaponPose = null) {
    this.prepare();
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.event && (slot.event.age >= slot.life || !effects.includes(slot.event))) slot.event = null;
    }
    for (let i = 0; i < effects.length; i++) {
      const event = effects[i];
      if (event.age !== 0 || !contact(event)) continue;
      let free = null, found = false;
      for (let j = 0; j < slots.length; j++) {
        if (slots[j].event === event) { found = true; break; }
        if (!slots[j].event && !free) free = slots[j];
      }
      if (found || !free) continue;
      let weapon = game.player.attack?.weapon ?? game.inventory?.equipped.weapon?.family;
      for (let j = i - 1; j >= 0; j--) {
        if (effects[j].type === 'swing') { weapon = effects[j].weapon; break; }
      }
      const family = weapon === 'staff' ? 2 : weapon === 'knuckles' ? 1 : 0;
      const heavy = event.strength === 'heavy';
      let angle = Math.atan2(event.dy, event.dx);
      const trail = weaponPose?.trail;
      if (family === 2 && trail?.length > 1) {
        const a = trail[trail.length - 2], b = trail[trail.length - 1];
        const tx = (b[0] - a[0]) * (weaponPose.flip ? -1 : 1), ty = b[1] - a[1];
        if (tx || ty) angle = Math.atan2(2 * ty + tx, 2 * ty - tx) - Math.PI / 2;
      }
      const direction = (Math.round(angle / (Math.PI / 4)) + DIRECTIONS) % DIRECTIONS;
      free.event = event; free.family = family;
      free.life = (heavy ? HEAVY_LIFE : LIGHT_LIFE)[family];
      free.scale = (heavy ? HEAVY_HIT_SCALE : HIT_SCALE)[family];
      free.row = (family * 2 + (heavy ? 1 : 0)) * DIRECTIONS + direction;
      free.x = event.x; free.y = event.y; free.height = 1.35;
      free.offsetX = 0; free.offsetY = 0;
      // Capture the drawn body, not its post-knockback ground event. Sprite pixels are billboard
      // pixels, so their mask's upper third stays at the actual shoulder for every target kind.
      for (let v = 0; views && v < views.length; v++) {
        const view = views[v];
        if (view.id !== event.id) continue;
        const sprite = view.sprite, atlas = sprite.atlas, p = sprite.mesh.position;
        free.x = p.x; free.y = p.z; free.height = p.y;
        free.offsetY = -30;
        for (let k = 0; k < this.silhouettes.length; k++) {
          const cache = this.silhouettes[k];
          if (cache.atlas !== atlas || !cache.mask) continue;
          const o = sprite.frame * 4, bounds = cache.bounds;
          let left = bounds[o], right = bounds[o + 2];
          const top = bounds[o + 1], bottom = bounds[o + 3];
          if (right <= left || bottom <= top) break;
          if (sprite.flip) { const oldLeft = left; left = atlas.cell - right; right = atlas.cell - oldLeft; }
          const side = Math.sign((game.player.y - event.y) - (game.player.x - event.x));
          free.offsetX = ((left + right) * .5 + side * (right - left) * .22 - atlas.anchor[0]) * sprite.mesh.scaling.x;
          free.offsetY = (top + (bottom - top) * .35 - atlas.anchor[1]) * sprite.mesh.scaling.y;
          break;
        }
        break;
      }
    }
  }

  draw(c, matrix, unit, width, height, reducedMotion = false) {
    if (!matrix || !this.image?.complete || !this.image.naturalWidth) return;
    const alpha = c.globalAlpha, blend = c.globalCompositeOperation, smoothing = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false; c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i], e = slot.event;
      if (!e || e.age >= slot.life) continue;
      const size = Math.max(1, Math.round(CELL * unit / 32 * slot.scale));
      const w = matrix[3] * slot.x + matrix[7] * slot.height + matrix[11] * slot.y + matrix[15];
      const x = Math.round((matrix[0] * slot.x + matrix[4] * slot.height + matrix[8] * slot.y + matrix[12]) / w
        + slot.offsetX * unit / 32) - Math.round(size / 2);
      const y = Math.round((matrix[1] * slot.x + matrix[5] * slot.height + matrix[9] * slot.y + matrix[13]) / w
        + slot.offsetY * unit / 32) - Math.round(size / 2);
      if (x + size <= 0 || x >= width || y + size <= 0 || y >= height) continue;
      const t = e.age / slot.life;
      let frame = reducedMotion ? 0 : Math.min(FRAMES - 1, Math.floor(t * FRAMES));
      // Three bright keys occupy exactly the first 50 ms (about three 60 Hz phone frames).
      if (!reducedMotion && slot.family === 1) frame = e.age < .05 ? Math.min(2, Math.floor(e.age / (.05 / 3)))
        : 3 + Math.min(2, Math.floor((e.age - .05) / (slot.life - .05) * 3));
      c.globalAlpha = (reducedMotion ? .65 : 1) * (t < .5 ? 1 : (1 - t) * 2);
      if (slot.family === 0) c.globalAlpha = (reducedMotion ? .65 : 1) * .72 * (1 - t) * (1 - t);
      c.drawImage(this.image, ((slot.row >= 24 ? FRAMES : 0) + frame) * CELL, (slot.row % 24) * CELL, CELL, CELL, x, y, size, size);
    }
    c.globalAlpha = alpha; c.globalCompositeOperation = blend; c.imageSmoothingEnabled = smoothing;
  }
}

const warningLengths = new WeakMap();
export function warningLength(enemy, world) {
  const ranged = enemy.kind === 'wraith';
  // Windups hold their position and heading. Cache only immutable scenery; mutable arenas
  // must still reflect collider edits on every call. The world owns a bounded cache.
  let lengths = world && warningLengths.get(world);
  if (world && lengths === undefined && Object.isFrozen(world)) {
    const obstacles = world.obstacles;
    lengths = Array.isArray(obstacles) && Object.isFrozen(obstacles) && obstacles.every(Object.isFrozen) ? new Map() : false;
    warningLengths.set(world, lengths);
  }
  const key = lengths ? `${enemy.x},${enemy.y},${enemy.dx},${enemy.dy},${ranged}` : null;
  if (lengths && lengths.has(key)) return lengths.get(key);
  const maximum = ranged ? WRAITH_STATS.shotSpeed * WRAITH_STATS.shotLife : 2.9;
  const radius = ranged ? WRAITH_STATS.shotRadius : .29;
  let length = 0;
  for (let distance = .12; distance <= maximum; distance += .12) {
    if (!isWalkable(enemy.x + enemy.dx * distance, enemy.y + enemy.dy * distance, radius, world)) break;
    length = distance;
  }
  if (lengths) {
    if (lengths.size >= 256) lengths.clear();
    lengths.set(key, length);
  }
  return length;
}

// The slam's rim: SLAM_RAYS + 1 points across its arc, clipped by the slam's own
// line test (game.js slamReaches: clearLine at .05, samples at most .15u apart).
// A ray whose full-range line passes keeps the full reach. Otherwise it marches
// out in .05u steps to its first blocked sample. A block that stays blocked for
// .15u stops every such line, so the ray ends there; a thinner block (a grazed
// corner) falls back to the farthest distance whose clearLine passes, plus one
// step. Each ray then takes its neighbours' reach, so a wall edge between two
// rays never cuts off ground the strike can still hit. A windup shell stands
// still, so its rim is computed once per position and facing.
export const SLAM_RAYS = 36;
const SLAM_SCAN = .05, SLAM_SOLID = 3;
const slamRims = new WeakMap();
function slamRim(enemy, world) {
  const { x, y, dx, dy } = enemy, range = BEETLE_STATS.slamRange, owner = world ?? legacyWorld;
  const key = `${x},${y},${dx},${dy},${enemy.radius}`;
  let rims = slamRims.get(owner);
  if (!rims || rims.size > 64) slamRims.set(owner, rims = new Map());
  if (rims.has(key)) return rims.get(key);
  const a = Math.atan2(dy, dx), half = Math.acos(BEETLE_STATS.slamDot);
  const angles = Array.from({ length: SLAM_RAYS + 1 }, (_, i) => a - half + 2 * half * i / SLAM_RAYS);
  const steps = Math.round(range / SLAM_SCAN);
  const reach = angles.map(angle => {
    const at = k => { const d = Math.min(range, k * SLAM_SCAN); return { x: x + Math.cos(angle) * d, y: y + Math.sin(angle) * d }; };
    const open = k => { const p = at(k); return isWalkable(p.x, p.y, .05, world); };
    if (clearLine(enemy, at(steps), .05, world)) return range;
    let first = 1;
    while (first <= steps && open(first)) first++;
    if (first > steps) return range;
    let solid = first;
    while (solid < Math.min(steps, first + SLAM_SOLID) && !open(solid + 1)) solid++;
    if (solid === Math.min(steps, first + SLAM_SOLID)) return Math.min(range, first * SLAM_SCAN);
    for (let k = steps; k > 0; k--) {
      if (clearLine(enemy, at(k), .05, world)) return Math.min(range, (k + (k < steps ? 1 : 0)) * SLAM_SCAN);
    }
    return 0;
  });
  const rim = angles.map((angle, i) => {
    const radius = Math.max(enemy.radius * .5, reach[Math.max(0, i - 1)], reach[i], reach[Math.min(SLAM_RAYS, i + 1)]);
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
  rims.set(key, rim);
  return rim;
}

// World outline of a windup's real danger zone. The shell's slam (game.js
// slamReaches) covers its reach within acos(slamDot) of the facing, plus half
// its radius all round, wherever walls let it through. Hound leaps and spirit
// shots follow a strip.
export function warningShape(enemy, world) {
  const { x, y, dx, dy } = enemy;
  if (enemy.kind === 'beetle') {
    const a = Math.atan2(dy, dx), half = Math.acos(BEETLE_STATS.slamDot), points = [...slamRim(enemy, world)];
    for (let i = 0; i <= 12; i++) {
      const angle = a + half + (TAU - 2 * half) * i / 12;
      points.push({ x: x + Math.cos(angle) * enemy.radius * .5, y: y + Math.sin(angle) * enemy.radius * .5 });
    }
    return points;
  }
  const width = enemy.kind === 'wraith' ? .15 : .28;
  const length = warningLength(enemy, world), tip = Math.max(0, length - .2);
  const side = { x: -dy * width, y: dx * width };
  return [
    { x: x + side.x, y: y + side.y }, { x: x + dx * tip + side.x, y: y + dy * tip + side.y },
    { x: x + dx * length, y: y + dy * length },
    { x: x + dx * tip - side.x, y: y + dy * tip - side.y }, { x: x - side.x, y: y - side.y },
  ];
}

// An opened cache and a used shrine, by id. Before the arrays in game.js, only the road's cache
// ('secret') and shrine ('road-shrine') have a flag: secretFound and shrineUsed.
const cacheFound = (game, id) => game.adventure?.cachesFound?.includes(id) ?? (id === 'secret' && !!game.adventure?.secretFound);
const shrineUsed = (game, id) => game.shrinesUsed?.includes(id) ?? (id === 'road-shrine' && !!game.shrineUsed);
// A built world's shrine sprites by id; a world built before the arrays has its one shrine sprite.
const shrineSprites = world => world.shrines ?? (world.shrine ? [{ id: 'road-shrine', sprite: world.shrine }] : []);
// Minimap tile colours by zone; any other zone (the courtyard) takes the last.
const ZONE_TILE_COLORS = { camp: '#bba07435', road: '#7bada535', cemetery: '#8fa39a35', orchard: '#a7b07a35' };

// The ritual source's clip: pixel-v11 'ritual-source', or the v2 shrine keys.
const ritualClip = atlas => atlas.clips['ritual-source'] ?? atlas.clips.shrine;

// The round minimap: a pixel circle MAP_CELLS whole --u cells across (styles.css sizes .map-frame to the
// same count), a 1u night outline and a 1u stone ring, the map inside.
export const MAP_CELLS = 72;
const MAP_RING = 2;
// The half-width, in cells, of each row of a pixel circle `cells` across, from the top row.
export function pixelCircleRows(cells) {
  const r = cells / 2;
  return Array.from({ length: cells }, (_, row) => Math.round(Math.sqrt(Math.max(0, r * r - (row + .5 - r) ** 2))));
}

export function adventureMapLayout(game, width = 360, height = 280) {
  const world = game.world || legacyWorld;
  // The map disc inside the ring, centred in the canvas.
  const center = { x: width / 2, y: height / 2 }, radius = Math.min(width, height) / 2 * (MAP_CELLS - 2 * MAP_RING) / MAP_CELLS;
  let centerU, centerV, scale;
  if (world.zones) {
    // The open world scrolls under the monk; the window is about 56 map units across at any size.
    const p = game.player ?? world.spawn;
    centerU = p.y - p.x; centerV = (p.x + p.y) / 2;
    scale = Math.min(Math.min(width, height) / 56, 8);
  } else {
    // A single location fits whole: its bounding box's corners stay inside the disc.
    const us = world.tiles.map(p => p.y - p.x), vs = world.tiles.map(p => (p.x + p.y) / 2);
    const minU = Math.min(...us) - 1, maxU = Math.max(...us) + 1;
    const minV = Math.min(...vs) - .5, maxV = Math.max(...vs) + .5;
    centerU = (minU + maxU) / 2; centerV = (minV + maxV) / 2;
    scale = Math.min(2 * (radius - 6) / Math.hypot(maxU - minU, maxV - minV), 12);
  }
  const project = (x, y) => ({ x: center.x + (y - x - centerU) * scale, y: center.y + ((x + y) / 2 - centerV) * scale });
  const visible = (x, y) => {
    if (!world.zones) return true;
    const p = project(x, y);
    return Math.hypot(p.x - center.x, p.y - center.y) <= radius - Math.max(4, scale);
  };
  const markers = world.portals.map(p => ({ ...p, kind: 'portal' }));
  for (const shrine of shrinesOf(world)) markers.push({ ...shrine, kind: 'shrine', used: shrineUsed(game, shrine.id) });
  for (const cache of cachesOf(world)) markers.push({ ...cache, kind: 'secret', used: cacheFound(game, cache.id) });
  if (world.reward) markers.push({ ...world.reward, kind: 'reward', used: game.adventure?.rewardCollected });
  if (!game.world) markers.push({ ...world.exit, kind: 'portal' });
  const p = game.player ?? world.spawn;
  const title = world.zones ? getOverworldZone(p.x, p.y).title : world.title;
  return { project, scale, visible, title, center, radius, tiles: world.tiles.filter(p => visible(p.x, p.y)),
    markers: markers.filter(p => visible(p.x, p.y)) };
}

export class Renderer {
  // options.onProgress follows the art loading (loadPixelAssets) for a preloader; options.graphics
  // switches the optional picture layers (scene-polish.js GRAPHICS_DEFAULTS, all on by default).
  constructor(canvas, effectsCanvas, mapCanvas, game, { onProgress = null, graphics = {}, hd2d = 'off' } = {}) {
    this.game = game;
    this.presentation = new PresentationState(game);
    this.fxSprites = new Map();
    this.canvas = canvas;
    this.overlay = effectsCanvas;
    this.ctx = effectsCanvas.getContext('2d');
    this.map = mapCanvas.getContext('2d');
    // CSS controls the compact phone map, its setting, and the enlarged pause map; hidden maps do no work.
    // A ResizeObserver reports the hidden (zero) size without forcing a layout.
    this.mapShown = true;
    if (globalThis.ResizeObserver && typeof Element !== 'undefined' && mapCanvas instanceof Element) {
      this.mapObserver = new ResizeObserver(entries => {
        const box = entries.at(-1).contentRect;
        this.mapShown = box.width > 0 && box.height > 0;
        const width = Math.round(box.width * 2), height = Math.round(box.height * 2);
        if (this.mapShown && (mapCanvas.width !== width || mapCanvas.height !== height)) {
          mapCanvas.width = width; mapCanvas.height = height;
        }
      });
      this.mapObserver.observe(mapCanvas);
    }
    // Phones and tablets size the world in device pixels (worldScale) and skip the per-frame copy
    // that a preserved drawing buffer costs a tiled mobile GPU; desktop keeps its options.
    this.coarsePointer = matchMedia('(pointer: coarse)').matches;
    this.engine = new Engine(canvas, false, { stencil: true, preserveDrawingBuffer: !this.coarsePointer, powerPreference: 'low-power' }, false);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#191523ff');
    this.scene.skipPointerMovePicking = true;
    this.camera = new ArcRotateCamera('isometric', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 1.2), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = .1; this.camera.maxZ = 100;
    this.camera.inputs.clear();
    this.followTarget = this.camera.target.clone();
    this.assets = loadPixelAssets(this.scene, { onProgress });
    // Hundreds of new materials: one dirty-marking pass at the end (batchMaterials).
    batchMaterials(this.scene, () => {
      this.world = buildPixelWorld(this.scene, this.assets, game.world);
      this.monk = createSprite(this.scene, 'monk', this.assets.monk);
      this.monkShadow = createShadow(this.scene, 'monk-shadow', SHADOWS.monk.radius, SHADOWS.monk);
      this.hounds = game.enemies.map(e => this.createEnemy(e));
    });
    this.locationRevision = game.locationRevision;
    this.projectiles = new Map();
    this.pickups = new Map();
    this.appearanceController = new SpriteAppearance(this.monk, url => loadAppearanceTexture(this.scene, url));
    this.scene.onDisposeObservable.add(() => this.appearanceController.dispose());
    this.monk.mesh.setEnabled(false);
    this.ready = this.assets.ready.then(() => this.warmPrograms());
    // Initial appearance failures remain recoverable through the same UI/API as
    // later selections; only common asset failures reject renderer readiness.
    this.updateAppearance(game).catch(() => {});
    this.shake = 0;
    this.bindLootAlt();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.polish = new ScenePolish(this, graphics);
    this.resize();
    this.snapCamera(game);
    // HD-2D core: install after stage-0 polish and the complete world exist.
    this.hd2d = createHD2D({ scene: this.scene, engine: this.engine, camera: this.camera, renderer: this }, hd2d);
  }

  // Prepare the standard shader variants before the play button opens. Small invisible pins
  // also keep the shared procedural shot/shadow textures alive between otherwise empty bursts.
  warmPrograms() {
    if (this.programWarmup) return this.programWarmup;
    this.programWarmup = (async () => {
      if (this.scene.isDisposed) return;
      const pins = this.warmPins = [];
      const keep = (view, kind) => {
        view.mesh.isVisible = false; view.mesh.setEnabled(false);
        pins.push({ ...view, kind });
        return view;
      };
      this.scene.onDisposeObservable.addOnce(() => { this.warmPins = []; });
      try {
        keep(createPixelBillboard(this.scene, 'warm-wraith', 'shot-wraith', wraithShotPixels), 'billboard');
        for (const kind of ['palm', 'reflected']) {
          keep(createPixelBillboard(this.scene, `warm-${kind}`, `shot-${kind}`, () => monkShotPixels(kind)), 'billboard');
        }
        for (const name of ['shot', 'palm']) {
          const mesh = createShadow(this.scene, `warm-${name}-shadow`, SHADOWS[name].radius, SHADOWS[name]);
          keep({ mesh, material: mesh.material }, 'shadow');
        }
        // Match the health pickup's default transparency mode and sphere attributes exactly.
        const health = MeshBuilder.CreateSphere('warm-health', { diameter: .17, segments: 2 }, this.scene);
        const healthInk = new StandardMaterial('warm-health-ink', this.scene);
        healthInk.disableLighting = true; healthInk.emissiveColor = Color3.FromHexString('#ffcf93');
        healthInk.diffuseColor = healthInk.emissiveColor; healthInk.specularColor = Color3.Black();
        health.material = healthInk;
        keep({ mesh: health, material: healthInk }, 'health');
        const atlas = keep(createSprite(this.scene, 'warm-atlas', this.assets.effects), 'sprite');
        for (const pin of pins) await pin.material.forceCompilationAsync(pin.mesh);
        health.scaling.set(.75, 1.35, .75); health.computeWorldMatrix(true);
        await healthInk.forceCompilationAsync(health);
        // Occluded atlas props also use an alpha-blend variant.
        const ink = atlas.material;
        ink.alpha = .25; ink.transparencyMode = Material.MATERIAL_ALPHABLEND;
        await ink.forceCompilationAsync(atlas.mesh);
        // Effect poses and pickup spheres also use NONUNIFORMSCALING defines.
        atlas.mesh.scaling.set(1, 2, 1); atlas.mesh.computeWorldMatrix(true);
        await ink.forceCompilationAsync(atlas.mesh);
        ink.alpha = 1; ink.transparencyMode = Material.MATERIAL_ALPHATEST;
        await ink.forceCompilationAsync(atlas.mesh);
      } catch (error) {
        for (const pin of pins) {
          if (pin.kind === 'sprite') disposeSprite(pin);
          else { pin.mesh.dispose(); if (pin.kind === 'shadow' || pin.kind === 'health') pin.material.dispose(); }
        }
        this.warmPins = [];
        throw error;
      }
    })();
    return this.programWarmup;
  }

  // Reuse Babylon's existing keyboard/blur sources; no extra DOM listener outlives the scene.
  bindLootAlt() {
    const keys = new Set();
    this.lootAlt = { get held() { return keys.size > 0; } };
    const keyboard = this.scene.onKeyboardObservable.add(({ event }) => {
      if (event.code !== 'AltLeft' && event.code !== 'AltRight') return;
      if (event.type === 'keydown') keys.add(event.code);
      else if (event.type === 'keyup') keys.delete(event.code);
    });
    const blur = this.engine.onCanvasBlurObservable.add(() => keys.clear());
    this.scene.onDisposeObservable.addOnce(() => {
      this.scene.onKeyboardObservable.remove(keyboard);
      this.engine.onCanvasBlurObservable.remove(blur); keys.clear();
    });
  }

  // Switches the optional picture layers: { propShade, lightPools, zoneGrade } (booleans).
  setGraphics(options) {
    this.polish?.set(options);
  }

  // HD-2D core: independent of the existing stage-0 graphics switch.
  setHD2D(settings) { this.hd2d.setTier(settings); }

  createEnemy(enemy) {
    const kind = enemy.kind || 'hound';
    // The ritual source uses the restyled pixel-v11 world frames when loaded.
    const atlas = kind === 'ritual' ? this.assets.monasteryWorld ?? this.assets.world : this.assets[kind];
    const sprite = createSprite(this.scene, `${kind}-${enemy.id}`, atlas,
      kind === 'ritual' ? ritualClip(atlas).front[0] : 0);
    const style = SHADOWS[kind] ?? SHADOWS.hound;
    const shadow = createShadow(this.scene, `${kind}-shadow-${enemy.id}`, style.radius, style);
    const warning = kind === 'ritual' ? null : createSprite(this.scene, `${kind}-warning-${enemy.id}`, this.assets.effects);
    if (warning) warning.mesh.isVisible = false;
    return { id: enemy.id, kind, body: enemy, sprite, shadow, warning };
  }

  disposeEnemy(view) {
    disposeSprite(view.sprite); disposeSprite(view.warning);
    const material = view.shadow.material;
    view.shadow.dispose(); material.dispose();
  }

  cameraDestination(game, p = game.player) {
    return game.world ? new Vector3(p.x, .1, p.y - .7) : new Vector3(p.x * .5, .1, p.y * .45 - .7);
  }


  snapCamera(game) {
    this.followTarget.copyFrom(this.cameraDestination(game));
    this.camera.target.copyFrom(this.followTarget);
    this.followPixels = null;
    this.shake = 0;
  }

  syncLocation(game) {
    const changed = this.game !== game || this.locationRevision !== game.locationRevision || this.world.data !== (game.world || legacyWorld);
    if (changed) {
      this.world.dispose();
      this.world = buildPixelWorld(this.scene, this.assets, game.world);
      for (const view of this.hounds) this.disposeEnemy(view);
      this.hounds = [];
      for (const sprite of this.fxSprites.values()) disposeSprite(sprite);
      this.fxSprites.clear();
      for (const view of this.projectiles?.values() || []) this.disposeProjectile(view);
      this.projectiles = new Map();
      for (const view of this.pickups?.values() || []) this.disposePickup(view);
      this.pickups = new Map();
      for (const view of this.monkShots?.values() || []) this.disposeBillboard(view);
      for (const view of this.groundItems?.values() || []) this.disposeGroundItem(view);
      this.monkShots = new Map(); this.groundItems = new Map();
      this.locationRevision = game.locationRevision;
      this.snapCamera(game);
    }
    // Object identity also covers a replacement within a location. Preserve views
    // through reorderings, never attach an old warning/death pose by array index.
    if (this.hounds.length === game.enemies.length && this.hounds.every((view, i) =>
      view.body === game.enemies[i] && view.kind === (game.enemies[i].kind || 'hound'))) return;
    const existing = new Set(this.hounds);
    const byBody = new Map(), byId = new Map();
    for (const view of this.hounds) {
      if (view.body) byBody.set(view.body, view);
      else byId.set(view.id, view);
    }
    const match = () => game.enemies.map(enemy => {
      const candidate = byBody.get(enemy) ?? byId.get(enemy.id);
      const view = candidate?.kind === (enemy.kind || 'hound') ? candidate : null;
      if (view) { existing.delete(view); view.body = enemy; return view; }
      return this.createEnemy(enemy);
    });
    // A new location creates all its enemies at once (batchMaterials); a frame without a change creates few.
    this.hounds = changed ? batchMaterials(this.scene, match) : match();
    for (const view of existing) this.disposeEnemy(view);
  }

  getAppearanceStatus(game) {
    return this.appearanceController?.getStatus(appearanceUrl(game)) || { status: 'loading' };
  }

  retryAppearance(game) {
    return this.updateAppearance(game, true);
  }

  updateAppearance(game, retry = false) {
    if (!this.appearanceController) return Promise.resolve();
    const url = appearanceUrl(game);
    return this.appearanceController.select(url, { retry }).then(applied => {
      if (applied) this.monk.mesh.setEnabled(true);
      return applied;
    });
  }

  resize() {
    // A phone sizes the world from the visual viewport: iPhone Safari's toolbar covers the bottom of
    // the layout viewport. Desktop keeps clientWidth/clientHeight, so a pinch-zoom never resizes the
    // world. The visual offsets keep the fixed canvases on it, rounded to device pixels.
    const dpr = globalThis.devicePixelRatio || 1, visual = this.coarsePointer ? globalThis.visualViewport : null;
    const fit = worldScale({ width: visual?.width ?? document.documentElement.clientWidth,
      height: visual?.height ?? document.documentElement.clientHeight, dpr, coarse: !!this.coarsePointer });
    const offsetX = Math.round((visual?.offsetLeft ?? 0) * dpr) / dpr, offsetY = Math.round((visual?.offsetTop ?? 0) * dpr) / dpr;
    // Leave less than one world pixel at the edge instead of stretching individual pixels.
    for (const canvas of [this.canvas, this.overlay]) {
      Object.assign(canvas.style, {
        width: `${fit.box.width}px`, height: `${fit.box.height}px`, left: `${fit.box.left + offsetX}px`, top: `${fit.box.top + offsetY}px`,
        right: 'auto', bottom: 'auto',
      });
    }
    this.engine.setHardwareScalingLevel(fit.cssPerPixel);
    this.engine.resize();
    // Babylon reads the rounded CSS size; a fractional touch box needs the exact world pixel count.
    this.engine.setSize(fit.renderWidth, fit.renderHeight);
    this.width = this.engine.getRenderWidth();
    this.height = this.engine.getRenderHeight();
    const halfHeight = this.height * CAMERA_VIEW_SCALE / (2 * PIXELS_PER_UNIT);
    const halfWidth = this.width * CAMERA_VIEW_SCALE / (2 * PIXELS_PER_UNIT);
    this.camera.orthoTop = halfHeight; this.camera.orthoBottom = -halfHeight;
    this.camera.orthoLeft = -halfWidth; this.camera.orthoRight = halfWidth;
    this.overlay.width = this.width; this.overlay.height = this.height;
    this.followPixels = null;
    this.ctx.imageSmoothingEnabled = false;
  }

  screenToWorld(x, y) {
    const rect = this.canvas?.getBoundingClientRect();
    const scale = this.engine.getHardwareScalingLevel();
    const width = this.engine.getRenderWidth(), height = this.engine.getRenderHeight();
    const nativeX = (x - (rect?.left || 0)) * (rect?.width ? width / rect.width : 1 / scale);
    const nativeY = (y - (rect?.top || 0)) * (rect?.height ? height / rect.height : 1 / scale);
    // Match the displayed nearest-sampled pixel, while keeping ground aim continuous.
    const sampleX = Math.floor(nativeX) + .5, sampleY = Math.floor(nativeY) + .5;
    const spriteScale = projectedSpriteScale(this.camera, height);
    // Hit tests use the sprites where the last frame drew them (blended, snapped), the
    // same positions as occlusion; the aim is the simulated body under that sprite.
    let target = null, nearest = Infinity;
    for (let i = 0; i < (this.hounds?.length || 0); i++) {
      const enemy = this.game?.enemies[i], sprite = this.hounds[i].sprite;
      if (!enemy || enemy.hp <= 0 || !sprite.mesh.isVisible || sprite.mesh.visibility <= 0 || !sprite.mesh.isEnabled()) continue;
      const origin = Vector3.Project(sprite.mesh.position, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(width, height));
      if (opaqueSpritePixel(sprite, origin, sampleX, sampleY, spriteScale)) {
        const distance = Vector3.DistanceSquared(this.camera.position, sprite.mesh.position);
        if (distance < nearest) { target = enemy; nearest = distance; }
      }
    }
    if (target) return { x: target.x, y: target.y };
    // Babylon divides by hardware scale; convert from the actual displayed rectangle.
    const ray = this.scene.createPickingRay(nativeX * scale, nativeY * scale, Matrix.Identity(), this.camera);
    const distance = ray.intersectsPlane(new Plane(0, 1, 0, 0));
    if (distance === null) return null;
    const point = ray.origin.add(ray.direction.scale(distance));
    return { x: point.x, y: point.z };
  }

  pixelsPerUnit() {
    return PIXELS_PER_UNIT * projectedSpriteScale(this.camera, this.height);
  }

  // Simulation positions stay continuous; only their drawn anchors are snapped.
  groundAnchor(x, y) {
    const pixelsPerUnit = this.pixelsPerUnit(), at = snapToLattice(x, y, pixelsPerUnit);
    const bias = SAMPLE_BIAS / pixelsPerUnit * Math.SQRT1_2;
    return { x: at.x - bias, y: at.y + bias };
  }

  // The follow lag in whole screen pixels (u, v / 2). A frame advances the monk by
  // a whole number of 1/120 s steps, so the continuous lag jitters by about one
  // pixel. The held offset walks one pixel at a time and only while the lag is
  // more than 1.5 px away, so a running monk holds still and a stop glides home.
  followOffset(dx, dy) {
    const pixelsPerUnit = this.pixelsPerUnit(), held = this.followPixels;
    const follow = (value, previous) => {
      if (previous == null) return Math.round(value);
      while (Math.abs(value - previous) > 1.5) previous += Math.sign(value - previous);
      return previous;
    };
    const u = (dy - dx) * Math.SQRT1_2 * pixelsPerUnit, v = (dy + dx) * Math.SQRT1_2 * .5 * pixelsPerUnit;
    const next = this.followPixels = { u: follow(u, held?.u), v: follow(v, held?.v) };
    const worldU = next.u / pixelsPerUnit, worldV = next.v / (.5 * pixelsPerUnit);
    return { x: (worldV - worldU) * Math.SQRT1_2, y: (worldV + worldU) * Math.SQRT1_2 };
  }

  // A whole-pixel shift from the drawn anchor, rounded before mirroring so a flipped
  // drawing moves its shadow by exactly the opposite amount.
  placeShadow(shadow, anchor, style, flip, height) {
    const pixelsPerUnit = this.pixelsPerUnit();
    const pixels = Math.round((style.offset ?? 0) * pixelsPerUnit / PIXELS_PER_UNIT) * (flip ? -1 : 1);
    const shift = pixels / pixelsPerUnit * Math.SQRT1_2;
    setVectorIfChanged(shadow.position, anchor.x - shift, height, anchor.y + shift);
  }

  project(x, y, height = 0) {
    const scratch = this.projectionScratch ??= {
      point: new Vector3(), projected: new Vector3(), viewport: this.camera.viewport.toGlobal(this.width, this.height),
      screen: new Matrix(), viewportMatrix: new Matrix(),
    };
    this.camera.viewport.toGlobalToRef(this.width, this.height, scratch.viewport);
    const transform = this.scene.getTransformMatrix(), viewport = scratch.viewport;
    // Babylon's ProjectToRef composes these matrices for every point. The overlay uses one
    // unchanged view for hundreds of points; retain the same Float32 product and rounding.
    if (scratch.transform !== transform || scratch.version !== transform.updateFlag
      || scratch.vx !== viewport.x || scratch.vy !== viewport.y || scratch.vw !== viewport.width || scratch.vh !== viewport.height) {
      Matrix.FromValuesToRef(viewport.width / 2, 0, 0, 0, 0, -viewport.height / 2, 0, 0, 0, 0, .5, 0,
        viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, .5, 1, scratch.viewportMatrix);
      transform.multiplyToRef(scratch.viewportMatrix, scratch.screen);
      scratch.transform = transform; scratch.version = transform.updateFlag;
      scratch.vx = viewport.x; scratch.vy = viewport.y; scratch.vw = viewport.width; scratch.vh = viewport.height;
    }
    scratch.point.set(x, height, y);
    Vector3.TransformCoordinatesToRef(scratch.point, scratch.screen, scratch.projected);
    const v = scratch.projected;
    return { x: Math.round(v.x), y: Math.round(v.y) };
  }

  // `motion` blends bodies between simulation steps; without it they draw as they are.
  render(game, dt, mode = 'playing', motion = null) {
    // A new run (main.js begin(true) keeps the renderer) starts without the last run's level-up light.
    if (game !== this.game) this.levelUpLight?.reset();
    // HD-2D core: a new run / continue can replace the built world.
    const hdWorld = this.world;
    this.syncLocation(game);
    this.game = game;
    if (hdWorld !== this.world) this.hd2d?.onWorld(this);
    this.motion = motion;
    // The controller owns errors and revision checks; the UI reads its status.
    this.updateAppearance(game).catch(() => {});
    dt = this.presentation.update(game, dt, mode);
    // The level-up light starts on this frame's level-up events and ages with the presentation (not while paused).
    const levelUp = this.levelUpLight ??= new LevelUpLight();
    if (game.events) levelUp.observe(game.events);
    levelUp.update(dt);
    const p = game.player, drawn = drawnAt(this, p);
    const t = this.presentation.time;
    const target = this.cameraDestination(game, drawn);
    this.followTarget = Vector3.Lerp(this.followTarget, target, 1 - Math.exp(-dt * 5));
    // The camera keeps a whole-pixel offset from the drawn monk. A steady follow
    // therefore holds him still on screen while the world scrolls by whole pixels.
    const lattice = snapToLattice(drawn.x, drawn.y, this.pixelsPerUnit());
    const lag = this.followOffset(this.followTarget.x - drawn.x, this.followTarget.z - drawn.y);
    const stableTarget = new Vector3(lattice.x + lag.x, .1, lattice.y + lag.y);
    const anchor = this.groundAnchor(drawn.x, drawn.y);
    if (!this.reducedMotion) {
      this.shake = Math.max(0, this.shake - dt * .75);
      if (mode !== 'paused') {
        for (const event of this.presentation.effects) {
          if (event.age !== 0) continue;
          const impulse = event.type === 'ritual-destroyed' ? .1 : event.type === 'hurt' ? .06
            : event.type === 'guard-break' ? .09 : event.type === 'slam' || event.type === 'crane-land' ? .05
            : event.type === 'palm-burst' ? .04 : event.type === 'deflect-success' ? .03 : event.type === 'block' ? .02
            : event.type === 'impact' ? event.strength === 'heavy' ? .08 : .025 : 0;
          this.shake = Math.max(this.shake, impulse);
        }
      }
      stableTarget.x += Math.sin(t * 80) * this.shake;
      stableTarget.z += Math.cos(t * 67) * this.shake;
    } else this.shake = 0;
    this.camera.target.copyFrom(stableTarget);

    const monkShown = this.monkShown = monkPose(p, this.assets.monk, this.presentation.player, this.assets.monkWeapons?.manifest ?? null);
    setSpriteFrame(this.monk, monkShown);
    const lift = ELEVATION * this.pixelsPerUnit();
    // The crane flight lifts the drawing along an arc in whole screen pixels; the ground stays flat.
    const airborne = p.technique?.id === 'crane' ? Math.sin(craneProgress(p.technique, drawn) * Math.PI) : 0;
    setActorPosition(this.monk.mesh, anchor.x, .025 + Math.round(airborne * CRANE_PEAK * lift) / lift, anchor.y,
      !p.moving && p.dashTime <= 0 && !p.technique);
    const playerFlash = this.presentation.player.flash > 0;
    this.monk.material.emissiveColor.set(1, playerFlash ? .5 : 1, playerFlash ? .6 : 1);
    // «Последний вздох»: while it shields him, the monk shimmers cool every .1 s (not under the hurt flash).
    if (!playerFlash && !this.reducedMotion && this.breathShield(p) && Math.floor(this.presentation.player.breathAge / .1) % 2) {
      this.monk.material.emissiveColor.set(.82, 1, 1);
    }
    this.updateMonkWeapon(monkShown);
    this.placeShadow(this.monkShadow, anchor, SHADOWS.monk, this.monk.flip, .023);
    // The contact shadow runs along the ground and shrinks toward the top of the arc.
    const monkShadowScale = 1 - airborne * .45;
    setVectorIfChanged(this.monkShadow.scaling, monkShadowScale, monkShadowScale, monkShadowScale);
    this.monkShadow.visibility = 1 - airborne * .4;
    for (let i = 0; i < this.hounds.length; i++) {
      const e = game.enemies[i], { sprite, shadow } = this.hounds[i];
      if (e.kind === 'ritual') {
        const frames = ritualClip(sprite.atlas).front, restyled = !!sprite.atlas.clips['ritual-source'];
        setSpriteFrame(sprite, { frame: frames[e.hp <= 0 ? 5 : e.sealed ? 0 : 2 + Math.floor(t * 4) % 3], flip: false });
        // The v11 keys carry their own magenta/turquoise and a dark broken
        // ruin; only the legacy v2 shrine is tinted and faded.
        sprite.mesh.visibility = e.hp <= 0 && !restyled ? .38 : 1;
        if (restyled) sprite.material.emissiveColor.set(1, 1, 1);
        else sprite.material.emissiveColor.set(e.sealed ? .85 : .55, e.sealed ? .55 : 1, 1);
      } else setSpriteFrame(sprite, (e.kind === 'wraith' ? wraithPose : e.kind === 'beetle' ? beetlePose : houndPose)(e, sprite.atlas, this.presentation.hounds[i]));
      // The leap height also lands on whole screen pixels.
      const jump = e.state === 'leap' ? Math.round(Math.sin((1 - e.timer / .27) * Math.PI) * .25 * lift) / lift : 0;
      // The shrine pedestal's contact diamond is centered at source pixel 124,
      // above the shared world-atlas anchor 144. Register it to the ground seal.
      const contactOffset = e.kind === 'ritual'
        ? Math.SQRT2 * ((sprite.atlas.anchor[1] - 124) / PIXELS_PER_UNIT + .025 * Math.sin(Math.PI / 3)) : 0;
      const body = drawnAt(this, e), at = e.kind === 'ritual' ? body : this.groundAnchor(body.x, body.y);
      // A raised dais under the source (footprint `standOn`) lifts its sprite.
      const stand = e.kind === 'ritual' ? this.world.ritual?.standOn ?? 0 : 0;
      setActorPosition(sprite.mesh, at.x + contactOffset, .025 + jump + stand, at.y + contactOffset,
        e.active === false && !e.returning);
      const flash = this.presentation.hounds[i].flash > 0;
      if (e.kind !== 'ritual' || flash) sprite.material.emissiveColor.set(1, flash ? .55 : 1, flash ? .7 : 1);
      this.placeShadow(shadow, at, SHADOWS[e.kind] ?? SHADOWS.hound, sprite.flip, .024);
      // A leaping hound's shadow shrinks and fades a little with its height.
      const shadowScale = 1 - jump * .8;
      setVectorIfChanged(shadow.scaling, shadowScale, shadowScale, shadowScale);
      shadow.visibility = e.hp > 0 ? 1 - jump * 1.4 : .3;
    }
    for (let i = 0; i < this.world.fires.length; i++) {
      const fire = this.world.fires[i];
      if (fire.sprite?.atlas === this.assets.campFlame) {
        const { frames, frameDurationMs } = fire.sprite.atlas.animation;
        const key = frames[Math.floor(t * 1000 / frameDurationMs) % frames.length];
        setSpriteFrame(fire.sprite, { frame: fire.sprite.atlas.frames.indexOf(key), flip: fire.sprite.flip });
      } else if (fire.sprite) setSpriteFrame(fire.sprite, worldPose(fire.clip, fire.sprite.atlas, this.presentation, i * .13));
      for (const [j, flame] of (fire.flames || []).entries()) {
        flame.scaling.y = 1 + Math.sin(t * 7 + j * 2) * .12;
        flame.rotation.y = Math.floor(t * 6 + j) * .35;
      }
    }
    for (const { id, sprite } of shrineSprites(this.world)) setSpriteFrame(sprite, worldPose('shrine', sprite.atlas, this.presentation, 0, id));
    if (this.world.gate?.atlas.clips?.gate) setSpriteFrame(this.world.gate, worldPose('gate', this.world.gate.atlas, this.presentation));
    // After every emissive of this frame: the light pools tint the actors standing in them.
    this.polish?.update(game, dt);
    this.world.campNpcs?.update(t, this.polish?.options, this.reducedMotion, this.polish?.lights);
    this.updateLocationState(game, t);
    this.freezeWorld();
    this.updateEffects(game);
    this.updateProjectiles(game);
    this.updatePickups(game, t);
    this.updateMonkShots(game);
    this.updateGroundItems(game, t);
    this.updateOcclusion(game);
    // HD-2D core: one guarded call, no effect work or allocations when all off.
    if (this.hd2d?.active) this.hd2d.update(dt, t);
    this.scene.render();
    this.drawOverlay(game, t, mode);
    if (this.mapShown !== false) this.drawMap(game);
  }

  // Scenery never moves and the camera never turns, so even billboards keep their first world
  // matrix. Freezing the static world meshes once skips their matrix and bounding work every frame.
  // Brazier flames and the reward bead keep moving; caches animate their UV frames.
  freezeWorld() {
    const world = this.world;
    if (!world?.meshes || world.frozen) return;
    world.frozen = true;
    const moving = new Set([...(world.fires ?? []).flatMap(fire => fire.flames ?? []), world.reward?.bead]
      .filter(Boolean));
    for (const mesh of world.meshes) {
      if (!moving.has(mesh) && !mesh.isWorldMatrixFrozen && !mesh.isDisposed()) mesh.freezeWorldMatrix();
    }
  }

  updateLocationState(game, time) {
    const world = this.world;
    if (world.supplies) {
      const atlas = world.supplies.atlas, taken = !!game.lootClaimed?.includes('camp-supplies');
      setSpriteFrame(world.supplies, { frame: atlas.frames.indexOf(taken ? atlas.empty : atlas.full), flip: false });
    }
    for (const cache of cachesOf(world)) {
      const pose = cache.glow.update(cacheFound(game, cache.id), time, {
        lightPools: this.polish?.options.lightPools ?? true, reducedMotion: !!this.reducedMotion,
      });
      setSpriteFrame(cache.sprite, { frame: pose.frame, flip: false });
      setSpriteFrame(cache.motes, { frame: pose.moteFrame, flip: false });
      cache.motes.material.alpha = pose.moteAlpha;
      cache.pool.material.alpha = pose.poolAlpha;
      cache.motes.mesh.setEnabled(pose.moteAlpha > 0);
      cache.pool.mesh.setEnabled(pose.poolAlpha > 0);
    }
    if (world.reward) {
      world.reward.bead.isVisible = game.adventure?.quest === 'return' && !game.adventure.rewardCollected;
      world.reward.bead.position.y = .65 + Math.sin(time * 2) * .08;
      world.reward.ring.visibility = game.adventure?.quest === 'return' ? 1 : .4;
    }
    if (world.ritual) {
      const source = game.enemies.find(e => e.kind === 'ritual');
      const alive = source && source.hp > 0;
      for (const shard of world.ritual.shards) shard.isVisible = !!alive && !!source.sealed;
      for (const ring of world.ritual.rings) ring.isVisible = !!alive;
      world.ritual.ink.emissiveColor.copyFrom(Color3.FromHexString(source?.sealed ? '#ba719c' : '#8ae8dc'));
      world.ritual.ink.diffuseColor.copyFrom(world.ritual.ink.emissiveColor);
      world.ritual.seal.visibility = alive ? 1 : .35;
    }
  }

  updateProjectiles(game) {
    this.projectiles ??= new Map();
    const active = new Set();
    for (const shot of game.projectiles || []) {
      active.add(shot.id);
      let view = this.projectiles.get(shot.id);
      // A magenta 8 px orb: enemy energy (§2.3). drawOverlay adds its trail.
      if (!view) {
        view = { ...createPixelBillboard(this.scene, `spirit-shot-${shot.id}`, 'shot-wraith', wraithShotPixels),
          shadow: createShadow(this.scene, `shot-shadow-${shot.id}`, SHADOWS.shot.radius, SHADOWS.shot) };
        this.projectiles.set(shot.id, view);
      }
      const body = drawnAt(this, shot), at = this.groundAnchor(body.x, body.y);
      view.mesh.position.set(at.x, WRAITH_SHOT_HEIGHT, at.y);
      this.placeShadow(view.shadow, at, SHADOWS.shot, false, .026);
    }
    for (const [id, view] of this.projectiles) if (!active.has(id)) {
      this.disposeProjectile(view); this.projectiles.delete(id);
    }
  }

  disposeProjectile(view) { this.disposeBillboard(view); }

  updatePickups(game, time) {
    this.pickups ??= new Map();
    const active = new Set();
    for (const drop of game.pickups ?? []) {
      active.add(drop.id);
      let view = this.pickups.get(drop.id);
      if (!view) {
        const mesh = MeshBuilder.CreateSphere(`health-drop-${drop.id}`, { diameter: .17, segments: 2 }, this.scene);
        const ink = new StandardMaterial(`health-drop-ink-${drop.id}`, this.scene);
        ink.disableLighting = true; ink.emissiveColor = Color3.FromHexString('#ffcf93');
        ink.diffuseColor = ink.emissiveColor; ink.specularColor = Color3.Black();
        mesh.material = ink; mesh.isPickable = false; mesh.renderingGroupId = 1;
        mesh.scaling.set(.75, 1.35, .75);
        view = { mesh }; this.pickups.set(drop.id, view);
      }
      view.mesh.position.set(drop.x, .17 + (this.reducedMotion ? 0 : Math.sin(time * 2.5) * .035), drop.y);
    }
    for (const [id, view] of this.pickups) if (!active.has(id)) {
      this.disposePickup(view); this.pickups.delete(id);
    }
  }

  disposePickup(view) {
    const material = view.mesh.material;
    view.mesh.dispose(); material.dispose();
  }

  // The weapon layer over the monk (§3.8): one sprite per layer atlas, at the monk's ground anchor.
  // Both billboards share one depth, so a constant bias toward the camera draws the layer on top.
  // It follows the monk's visibility and hit tint; only the pose's layer shows.
  updateMonkWeapon(shown) {
    this.weaponSprites ??= {};
    const layer = shown.weapon?.layer, atlas = layer ? this.assets.monkWeapons?.[layer] : null;
    if (atlas && !this.weaponSprites[layer]) {
      const sprite = this.weaponSprites[layer] = createSprite(this.scene, `monk-${layer}`, atlas);
      sprite.material.zOffset = sprite.material.zOffsetUnits = -2;
    }
    for (const [name, sprite] of Object.entries(this.weaponSprites)) {
      const on = name === layer && !!atlas;
      sprite.mesh.setEnabled(on && this.monk.mesh.isEnabled());
      if (!on) continue;
      setSpriteFrame(sprite, { frame: shown.weapon.cell, flip: shown.weapon.flip });
      sprite.mesh.position.copyFrom(this.monk.mesh.position);
      sprite.material.emissiveColor.copyFrom(this.monk.material.emissiveColor);
    }
  }

  // A height above the ground that lands on whole screen pixels.
  heightOnLattice(height) {
    const lift = ELEVATION * this.pixelsPerUnit();
    return Math.round(height * lift) / lift;
  }

  // Palms and reflected shots (§2.3): an 8 px procedural billboard over a small contact shadow.
  // drawOverlay adds the trail.
  updateMonkShots(game) {
    this.monkShots ??= new Map();
    const active = new Set(), height = this.heightOnLattice(MONK_SHOT_HEIGHT);
    for (const shot of game.monkShots ?? []) {
      active.add(shot.id);
      let view = this.monkShots.get(shot.id);
      if (!view) {
        const kind = shot.kind === 'palm' ? 'palm' : 'reflected';
        view = { ...createPixelBillboard(this.scene, `monk-shot-${shot.id}`, `shot-${kind}`, () => monkShotPixels(kind)),
          shadow: createShadow(this.scene, `monk-shot-shadow-${shot.id}`, SHADOWS.palm.radius, SHADOWS.palm) };
        this.monkShots.set(shot.id, view);
      }
      const body = drawnAt(this, shot), at = this.groundAnchor(body.x, body.y);
      view.mesh.position.set(at.x, height, at.y);
      this.placeShadow(view.shadow, at, SHADOWS.palm, false, .026);
    }
    for (const [id, view] of this.monkShots) if (!active.has(id)) {
      this.disposeBillboard(view); this.monkShots.delete(id);
    }
  }

  // Items on the ground (§5.4). With the pixel-v12 atlas each item is a stack of flat ground
  // drawings; if the atlas failed to load, a procedural 16 px icon stands in (drawOverlay then
  // adds its glow, column and glint). A view built on the atlas is rebuilt if the atlas fails later.
  updateGroundItems(game, time) {
    this.groundItems ??= new Map();
    const active = new Set(), atlas = this.assets?.lootGround, ready = !!atlas && !atlas.failed;
    for (const ground of game.groundItems ?? []) {
      active.add(ground.id);
      let view = this.groundItems.get(ground.id);
      if (view?.layers && !ready) { this.disposeGroundItem(view); view = null; }
      if (!view) {
        const frames = ready ? lootGroundFrames(ground.item) : null;
        view = frames ? this.createLootStack(ground, frames, time) : this.createPixelItem(ground, time);
        this.groundItems.set(ground.id, view);
      }
      // Only a real drop event starts the toss. Restored items remain on the ground.
      for (const event of this.presentation.effects) if (event.type === 'loot-drop' && event.id === ground.id) {
        view.dropBorn = time - event.age;
      }
      if (view.layers) this.placeLootStack(view, ground, time);
      else this.placePixelItem(view, ground, time);
      const pose = lootDropPose(time - view.dropBorn, this.reducedMotion);
      const mesh = view.layers?.item.mesh ?? view.mesh, shift = groundDrawingOffset(pose.shift, 0);
      mesh.position.x += shift.x; mesh.position.z += shift.y;
      mesh.position.y += this.heightOnLattice(pose.height);
    }
    for (const [id, view] of this.groundItems) if (!active.has(id)) {
      this.disposeGroundItem(view); this.groundItems.delete(id);
    }
  }

  // The package stack, far to near: ring, shadow, beam, item, glint (LOOT_GROUND.stack). The
  // layers are coplanar, so each nearer layer gets a stronger depth bias toward the camera and
  // alphaIndex orders the blended ones. A bias away from the camera would sink a layer under the
  // floor, .025u below. The item and its shadow have binary alpha; the shadow is drawn at .4.
  createLootStack(ground, frames, born) {
    const layers = {};
    for (const [order, layer] of LOOT_STACK.entries()) {
      // Configure the fresh ink before attaching it to a mesh. Setting these
      // flags afterwards makes Babylon scan the scenery for each loot layer.
      const sprite = createSprite(this.scene, `loot-${layer}-${ground.id}`, this.assets.lootGround, [frames[layer]].flat()[0], {
        transparencyMode: layer === 'item' ? Material.MATERIAL_ALPHATEST : Material.MATERIAL_ALPHABLEND,
        alpha: layer === 'shadow' ? LOOT_GROUND.shadow.drawAlpha : 1,
      });
      layOnGround(sprite);
      sprite.material.zOffset = sprite.material.zOffsetUnits = -order;
      sprite.mesh.alphaIndex = order;
      layers[layer] = sprite;
    }
    return { layers, frames, born };
  }

  // Items lie flat and still: the ring pulses every .5 s; the beam shows for the drop column,
  // stepping every .3 s; then a glint flashes for .16 s every 2 s. Reduced motion: frame 0, no glint.
  placeLootStack(view, ground, time) {
    const { layers, frames } = view, timing = LOOT_GROUND.timing, still = this.reducedMotion;
    const at = this.groundAnchor(ground.x, ground.y), age = time - view.born;
    for (const sprite of Object.values(layers)) sprite.mesh.position.set(at.x, LOOT_HEIGHT, at.y);
    const step = (seconds, every) => still ? 0 : Math.floor(Math.max(0, seconds) / every) % 2;
    setSpriteFrame(layers.ring, { frame: frames.ring[step(age, timing.ringStepSeconds)], flip: false });
    layers.beam.mesh.isVisible = age < DROP_COLUMN;
    setSpriteFrame(layers.beam, { frame: frames.beam[step(age, timing.beamStepSeconds)], flip: false });
    const cycle = (age - DROP_COLUMN) % timing.glintEverySeconds;
    layers.glint.mesh.isVisible = !still && age >= DROP_COLUMN && cycle < timing.glintSeconds;
    setSpriteFrame(layers.glint, { frame: frames.glint[cycle < timing.glintSeconds / 2 ? 0 : 1], flip: false });
    const shift = groundDrawingOffset(...frames.glintOffset);
    layers.glint.mesh.position.set(at.x + shift.x, LOOT_HEIGHT, at.y + shift.y);
  }

  // Fallback: a procedural 16 px icon with its rarity's inlay over a contact shadow, bobbing one
  // screen pixel in two steps.
  createPixelItem(ground, born) {
    const { family, rarity } = ground.item;
    return { ...createPixelBillboard(this.scene, `ground-item-${ground.id}`, `item-${family}-${rarity}`, () => itemIconPixels(family, rarity)),
      shadow: createShadow(this.scene, `ground-item-shadow-${ground.id}`, SHADOWS.item.radius, SHADOWS.item), born };
  }

  placePixelItem(view, ground, time) {
    const at = this.groundAnchor(ground.x, ground.y), lift = ELEVATION * this.pixelsPerUnit();
    const bob = this.reducedMotion ? 0 : Math.floor((time - view.born) / .6) % 2;
    view.mesh.position.set(at.x, .025 + (ITEM_REST + bob) / lift, at.y);
    this.placeShadow(view.shadow, at, SHADOWS.item, false, .024);
  }

  disposeGroundItem(view) {
    if (view.layers) for (const sprite of Object.values(view.layers)) disposeSprite(sprite);
    else this.disposeBillboard(view);
  }

  disposeBillboard(view) {
    view.mesh.dispose();
    const material = view.shadow.material;
    view.shadow.dispose(); material.dispose();
  }

  updateEffects(game) {
    const weaponHits = this.weaponHits ??= new WeaponHitFx(null, this.assets);
    weaponHits.sync(this.presentation.effects, game, this.hounds, this.monkShown?.weapon);
    const active = new Set();
    for (const event of this.presentation.effects) {
      const name = event.type === 'heal' ? 'healing' : event.type;
      if (name !== 'impact' && name !== 'healing') continue;
      if (weaponHits.replaces(event)) continue;
      const pose = effectPose(name, this.assets.effects, event.age);
      if (!pose) continue;
      active.add(event);
      let sprite = this.fxSprites.get(event);
      if (!sprite) {
        sprite = createSprite(this.scene, `fx-${name}`, this.assets.effects);
        this.fxSprites.set(event, sprite);
      }
      setSpriteFrame(sprite, pose);
      sprite.mesh.position.set(event.x, name === 'impact' ? .65 : .03, event.y);
      sprite.mesh.scaling.setAll(name === 'impact' ? event.strength === 'heavy' ? 1 : .7 : 1);
    }
    for (const [event, sprite] of this.fxSprites) {
      if (active.has(event)) continue;
      disposeSprite(sprite);
      this.fxSprites.delete(event);
    }
    for (let i = 0; i < this.hounds.length; i++) {
      const enemy = game.enemies[i], warning = this.hounds[i].warning;
      if (!warning) continue;
      const duration = windupDuration(enemy);
      // The shell's ring-and-chevron would promise a wider or longer zone than its
      // slam; the overlay draws that sector instead.
      const pose = enemy.hp > 0 && enemy.state === 'windup' && enemy.kind !== 'beetle'
        ? effectPose('warning', this.assets.effects, Math.min(.55 - 1e-6, Math.max(0, 1 - enemy.timer / duration) * .55)) : null;
      warning.mesh.isVisible = !!pose;
      if (pose) {
        setSpriteFrame(warning, pose);
        setGroundEffectDirection(warning, enemy.dx, enemy.dy);
        const body = drawnAt(this, enemy), at = this.groundAnchor(body.x, body.y);
        warning.mesh.position.set(at.x, .035, at.y);
        warning.material.emissiveColor.set(...(enemy.kind === 'wraith' ? WRAITH_WARNING_TINT : [1, 1, 1]));
      }
    }
  }

  // Persistent rarity light is a gameplay marker, independent of the optional graphics layers.
  // Overlay pixels add no meshes, materials, textures or Babylon draw calls.
  drawGroundItems(game, time, unit) {
    const blockers = this.lootActorBoxes(game);
    for (const ground of game.groundItems ?? []) {
      const s = this.project(ground.x, ground.y, .03);
      if (s.x < -unit || s.x > this.width + unit || s.y < -unit || s.y > this.height + unit * 2) continue;
      const light = lootLightState(ground.item?.rarity, time, this.reducedMotion);
      const top = this.project(ground.x, ground.y, light.pillarHeight);
      drawLootLight(this.ctx, { x: s.x, y: s.y, tipY: top.y, unit, rarity: ground.item?.rarity,
        time, reducedMotion: this.reducedMotion, blockers });
    }
  }

  // Conservative silhouette boxes keep both the light and the name plates clear of living actors.
  lootActorBoxes(game) {
    const unit = this.pixelsPerUnit();
    return [game.player, ...game.enemies.filter(enemy => enemy.hp > 0)].map(body => {
      const at = drawnAt(this, body), altitude = body === game.player ? this.monk?.mesh.position.y ?? 0 : 0;
      const p = this.project(at.x, at.y, altitude);
      return { x: p.x - unit * .7, y: p.y - unit * 1.95, width: unit * 1.4, height: unit * 2.1 };
    }).filter(box => box.x + box.width >= 0 && box.x <= this.width && box.y + box.height >= 0 && box.y <= this.height);
  }

  drawGroundLabels(game) {
    const c = this.ctx, hero = drawnAt(this, game.player), unit = this.pixelsPerUnit();
    const scale = this.engine.getHardwareScalingLevel(), font = Math.max(7, 13 / scale), padding = 4;
    c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.font = `600 ${font}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const labels = [];
    for (const ground of game.groundItems ?? []) {
      if (!lootLabelVisible(ground, hero, { alt: this.lootAlt?.held, touch: this.coarsePointer })) continue;
      const p = this.project(ground.x, ground.y, .3);
      if (p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) continue;
      const text = ground.item?.name ?? 'Предмет', measured = c.measureText(text)?.width;
      labels.push({ id: ground.id, x: p.x, y: p.y, width: Math.ceil((measured ?? text.length * font * .6) + padding * 2),
        height: Math.ceil(font + 7), text, color: lootLightState(ground.item?.rarity, 0).color });
    }
    const placed = placeLootLabels(labels, { width: this.width, height: this.height - Math.ceil(unit * 1.8),
      blockers: this.lootActorBoxes(game) });
    for (const label of placed) {
      const { x, y, width, height, color, text } = label;
      // The HUD's night outline, stepped corners, stone bevel and coal inset.
      c.fillStyle = NIGHT; c.fillRect(x + 1, y, width - 2, height); c.fillRect(x, y + 1, width, height - 2);
      c.fillStyle = '#6c6179'; c.fillRect(x + 1, y + 1, width - 2, 1); c.fillRect(x + 1, y + 1, 1, height - 2);
      c.fillStyle = '#44394f'; c.fillRect(x + 2, y + height - 2, width - 3, 1);
      c.fillStyle = '#211a2b'; c.fillRect(x + 2, y + 2, width - 4, height - 4);
      c.fillStyle = color; c.fillText(text, x + padding, y + height / 2, Math.max(1, width - padding * 2));
    }
    c.restore();
  }

  // A short trail behind each drawn shot, never behind its starting point: turquoise for the
  // monk's palms and reflected shots, magenta for wraith shots.
  drawShotTrails(game) {
    const c = this.ctx;
    const trails = [...(game.monkShots ?? []).map(shot => [shot, shot.travelled, shot.kind === 'palm' ? SPIRIT_LIGHT : SPIRIT]),
      ...(game.projectiles ?? []).map(shot => [shot, (WRAITH_STATS.shotLife - (shot.life ?? WRAITH_STATS.shotLife)) * WRAITH_STATS.shotSpeed,
        WRAITH_INK])];
    const monkHeight = game.monkShots?.length ? this.heightOnLattice(MONK_SHOT_HEIGHT) : 0;
    for (const [shot, travelled, color] of trails) {
      const body = drawnAt(this, shot), height = color === WRAITH_INK ? WRAITH_SHOT_HEIGHT : monkHeight;
      for (let k = 1; k <= 4 && k * .14 <= (travelled ?? Infinity) + 1e-9; k++) {
        const s = this.project(body.x - shot.dx * k * .14, body.y - shot.dy * k * .14, height), size = k < 3 ? 2 : 1;
        c.globalAlpha = .75 * (1 - k / 5); c.fillStyle = color;
        c.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      }
    }
    c.globalAlpha = 1;
  }

  // Swing cell pixels are monk-sprite pixels: the cell anchor [80, 104] sits on the monk's ground
  // anchor and a flip mirrors about it. The tips of the last keys stay as fading 2 px afterimages;
  // lines between them would cut a chord across a spin, whose tips jump across the body.
  drawStaffTrail(weapon, fade) {
    const c = this.ctx, scale = this.pixelsPerUnit() / PIXELS_PER_UNIT;
    const [ax, ay] = this.assets.monkWeapons?.staffAttacks?.anchor ?? [80, 104];
    const origin = this.project(this.monk.mesh.position.x, this.monk.mesh.position.z, this.monk.mesh.position.y);
    const tips = weapon.trail.slice(-4, -1);
    c.globalCompositeOperation = 'screen'; c.fillStyle = '#f2e4c6';
    tips.forEach(([x, y], i) => {
      c.globalAlpha = fade * (i + 1) / (tips.length + 1);
      c.fillRect(Math.round(origin.x + (weapon.flip ? ax - x : x - ax) * scale) - 1, Math.round(origin.y + (y - ay) * scale) - 1, 2, 2);
    });
    c.globalAlpha = fade;
  }

  // Touch aiming (mobile-touch §8, board 05). view = { preview, markedTarget } from TouchInput:
  // the held technique's ground preview and the id of rule A's target; null hides both.
  setTouchView(view) {
    this.touchView = view ?? null;
  }

  // A world offset on the ground, from a projected point, in overlay pixels (2:1 isometric).
  groundOffset(origin, wx, wy, unit = this.pixelsPerUnit()) {
    return { x: origin.x + (wy - wx) * Math.SQRT1_2 * unit, y: origin.y + (wx + wy) * Math.SQRT1_2 * .5 * unit };
  }

  // Whole-pixel marks: `points` in overlay pixels, each drawn 1 px, optionally over a 3 px --night outline.
  pixelMarks(points, color, outline = false) {
    const c = this.ctx;
    if (outline) { c.fillStyle = NIGHT; for (const p of points) c.fillRect(p.x - 1, p.y - 1, 3, 3); }
    c.fillStyle = color;
    for (const p of points) c.fillRect(p.x, p.y, 1, 1);
  }

  // The pixels of a line, `dash` on and `gap` off (gap 0: solid).
  pixelLine(a, b, dash = 3, gap = 2) {
    const steps = Math.max(1, Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)))), points = [];
    for (let i = 0; i <= steps; i++) {
      if (gap && i % (dash + gap) >= dash) continue;
      points.push({ x: Math.round(a.x + (b.x - a.x) * i / steps), y: Math.round(a.y + (b.y - a.y) * i / steps) });
    }
    return points;
  }

  // The pixels of a ground circle (a 2:1 ellipse) of `radius` around `origin`, from world angle
  // `from` to `to`, dashed like pixelLine.
  pixelRing(origin, radius, unit, dash = 3, gap = 2, from = 0, to = TAU) {
    const steps = Math.max(8, Math.ceil(radius * unit * Math.abs(to - from))), points = [];
    let previous = null, index = 0;
    for (let i = 0; i <= steps; i++) {
      const a = from + (to - from) * i / steps, s = this.groundOffset(origin, Math.cos(a) * radius, Math.sin(a) * radius, unit);
      const p = { x: Math.round(s.x), y: Math.round(s.y) };
      if (previous && p.x === previous.x && p.y === previous.y) continue;
      previous = p;
      if (!gap || index++ % (dash + gap) < dash) points.push(p);
    }
    return points;
  }

  // The held technique: dashed reach rings, then the palm's 1u --spirit line with a --night outline
  // and an arrowhead (with rule A's cone in auto mode), or the crane's and bell's landing zone,
  // --spirit 15% with a 1u edge, on a thin line. Over «Отмена» everything turns --muted and fades.
  // Rule A's target, from the preview or the strike, gets 1u --ivory corners around its shadow.
  drawTouchView(game, hero) {
    const c = this.ctx, { preview, markedTarget } = this.touchView, unit = this.pixelsPerUnit();
    c.globalCompositeOperation = 'source-over';
    if (preview) {
      const marker = touchAimMarker(game, preview, hero), at = this.groundAnchor(hero.x, hero.y);
      const origin = this.project(at.x, at.y, .03), ink = marker.cancel ? MUTED : SPIRIT, faded = marker.cancel ? .45 : 1;
      c.globalAlpha = .55 * faded;
      this.pixelMarks(this.pixelRing(origin, marker.max, unit), ink);
      if (marker.min > 0 && marker.min < marker.max) { c.globalAlpha = .35 * faded; this.pixelMarks(this.pixelRing(origin, marker.min, unit, 1, 3), ink); }
      const heading = Math.atan2(marker.dy, marker.dx), end = this.groundOffset(origin, marker.end.x - marker.x, marker.end.y - marker.y, unit);
      // Lines start clear of the monk's feet.
      const start = this.groundOffset(origin, marker.dx * TOUCH_LINE_START, marker.dy * TOUCH_LINE_START, unit);
      if (marker.cone) {
        const half = marker.cone * Math.PI / 180, edges = [-half, half].map(turn => this.groundOffset(origin,
          Math.cos(heading + turn) * marker.max, Math.sin(heading + turn) * marker.max, unit));
        c.globalAlpha = .35 * faded;
        this.pixelMarks([...edges.flatMap(edge => this.pixelLine(origin, edge, 1, 2)),
          ...this.pixelRing(origin, marker.max, unit, 1, 0, heading - half, heading + half)], ink);
      }
      c.globalAlpha = faded;
      if (marker.kind === 'line') {
        // An arrowhead: two 3 px barbs back from the tip, at ±35° on screen.
        const back = Math.atan2(origin.y - end.y, origin.x - end.x);
        const barbs = [-.6, .6].flatMap(turn => this.pixelLine(end,
          { x: end.x + Math.cos(back + turn) * 4, y: end.y + Math.sin(back + turn) * 4 }, 5, 0));
        this.pixelMarks([...this.pixelLine(start, end), ...barbs], ink, true);
      } else {
        this.pixelMarks(this.pixelLine(start, end, 1, 2), ink);
        if (marker.zone > 0) {
          c.globalAlpha = .15 * faded; c.fillStyle = ink;
          c.beginPath(); c.ellipse(end.x, end.y, marker.zone * unit, marker.zone * unit / 2, 0, 0, TAU); c.fill();
          c.globalAlpha = faded;
          this.pixelMarks(this.pixelRing(end, marker.zone, unit, 1, 0), ink);
        }
        this.pixelMarks([{ x: Math.round(end.x), y: Math.round(end.y) }], ink, true);
      }
    }
    c.globalAlpha = 1;
    const targets = new Set([markedTarget, preview?.target?.id].filter(id => id != null));
    for (const enemy of game.enemies) {
      if (!targets.has(enemy.id) || enemy.hp <= 0) continue;
      const body = drawnAt(this, enemy), at = this.groundAnchor(body.x, body.y), s = this.project(at.x, at.y, .024);
      const style = SHADOWS[enemy.kind] ?? SHADOWS.hound, w = Math.round(style.radius * unit) + 2, h = Math.round(style.radius * unit / 2) + 2;
      const corners = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = Math.round(s.x + sx * w), y = Math.round(s.y + sy * h);
        for (let i = 0; i < 3; i++) corners.push({ x: x - sx * i, y }, { x, y: y - sy * i });
      }
      this.pixelMarks(corners, IVORY);
    }
  }

  // Technique states (§2.3): the empty landing ring of a crane flight, the deflect stance ring.
  drawTechnique(game, hero, time) {
    const c = this.ctx, technique = game.player.technique;
    c.globalCompositeOperation = 'screen';
    if (technique.id === 'crane') {
      const radius = technique.params?.radius ?? 1.6, f = craneProgress(technique, hero);
      c.globalAlpha = .55 + .45 * f;
      this.drawRing(technique.toX, technique.toY, radius, .03, SPIRIT, 1);
      // An inner ring closes on the landing point as the flight ends.
      c.globalAlpha = .5;
      this.drawRing(technique.toX, technique.toY, Math.max(.15, radius * (1 - f)), .03, SPIRIT_LIGHT, 1);
    } else if (technique.id === 'deflect') {
      const at = this.groundAnchor(hero.x, hero.y), a = Math.atan2(game.player.dy, game.player.dx);
      c.globalAlpha = this.reducedMotion || Math.floor(time * 24) % 2 ? 1 : .7;
      this.drawRing(at.x, at.y, .6, .04, SPIRIT, 1);
      this.drawRing(at.x, at.y, .45, .75, SPIRIT_LIGHT, 1, a - 1.2, a + 1.2);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // True while «Последний вздох» shields the monk: its presentation timer runs and he cannot be hurt.
  breathShield(player) {
    return this.presentation.player.breathAge != null && player.invulnerable > 0 && player.hp > 0;
  }

  // One-shot technique and loot events. The caller sets the screen blend and the fade alpha.
  drawTechniqueEffect(game, effect, fade) {
    const c = this.ctx, { x, y, age, life, type } = effect, progress = age / life;
    const sparks = (count, from, to, height, color, offset = 0, size = 2) => {
      for (let i = 0; i < count; i++) {
        const a = i / count * TAU + offset, r = from + (to - from) * progress;
        const s = this.project(x + Math.cos(a) * r, y + Math.sin(a) * r, height + progress * .3);
        c.fillStyle = color; c.fillRect(s.x, s.y, size, size);
      }
    };
    if (type === 'palm') {
      // The palm leaves the hand with a small turquoise flash.
      const hx = x + (effect.dx ?? 0) * .35, hy = y + (effect.dy ?? 0) * .35;
      this.drawRing(hx, hy, .12 + progress * .35, MONK_SHOT_HEIGHT, SPIRIT_LIGHT, 2 * fade);
    } else if (type === 'crane') {
      // Take-off dust.
      sparks(10, .2, .7, .04, '#e9dcc4', .3);
    } else if (type === 'deflect') {
      if (age < .12) this.drawRing(x, y, .3 + age / .12 * .3, .05, SPIRIT_LIGHT, 2);
    } else if (type === 'deflect-success') {
      // The coral flash of a deflected attack.
      const s = this.project(x, y, .7), radius = this.height / (this.camera.orthoTop * 2) * .7;
      const glow = this.ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
      glow.addColorStop(0, CORAL); glow.addColorStop(1, `${CORAL}00`);
      c.fillStyle = glow; c.fillRect(s.x - radius, s.y - radius, radius * 2, radius * 2);
      this.drawRing(x, y, .45 + progress * .8, .6, CORAL, 3 * fade);
      sparks(8, .4, 1.1, .6, CORAL_LIGHT, .2);
    } else if (type === 'deflect-whiff') {
      this.drawRing(x, y, .6 - progress * .3, .05, '#b4aaba', 1);
    } else if (type === 'shot-fade' || type === 'shot-destroyed') {
      // A palm touches with a coral flash; reflected and destroyed shots go out in turquoise.
      const color = type === 'shot-fade' && effect.kind === 'palm' ? CORAL : '#7cffe1';
      const height = type === 'shot-destroyed' ? .65 : MONK_SHOT_HEIGHT;
      this.drawRing(x, y, .08 + progress * .35, height, color, 2 * fade);
      sparks(6, .1, .45, height, color === CORAL ? CORAL_LIGHT : SPIRIT_LIGHT);
    } else if (type === 'palm-burst') {
      this.drawRing(x, y, .3 + progress * ((effect.radius ?? 2) - .3), .06, CORAL, 3 * fade);
      sparks(10, .3, effect.radius ?? 2, .3, CORAL_LIGHT, .3, 3);
    } else if (type === 'relic-chain') {
      // A three-step amber bolt from the first victim to the next.
      const to = game.enemies.find(e => e.id === effect.to);
      if (!to) return;
      const end = drawnAt(this, to), points = [0, 1, 2, 3].map(k => {
        const t = k / 3, side = k % 3 ? (k % 2 ? .18 : -.18) : 0;
        const nx = -(end.y - y), ny = end.x - x, length = Math.hypot(nx, ny) || 1;
        return this.project(x + (end.x - x) * t + nx / length * side, y + (end.y - y) * t + ny / length * side, .7);
      });
      c.beginPath(); points.forEach((p, k) => k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
      c.strokeStyle = AMBER; c.lineWidth = 2 * fade; c.stroke();
    } else if (type === 'loot-drop') {
      const pose = lootDropPose(age, this.reducedMotion), ink = rarityInk(effect.item?.rarity);
      if (pose.flash > 0) {
        const s = this.project(x, y, .08), size = Math.max(1, Math.round(this.pixelsPerUnit() / PIXELS_PER_UNIT));
        c.globalAlpha = pose.flash; c.fillStyle = ink;
        this.drawRing(x, y, .15 + (1 - pose.flash) * .35, .03, ink, size);
        c.fillRect(s.x - size, s.y - size * 5, size * 2, size * 10);
        c.fillRect(s.x - size * 5, s.y - size, size * 10, size * 2);
        c.fillStyle = '#fff7e4'; c.fillRect(s.x - size, s.y - size, size * 2, size * 2);
      }
    } else if (type === 'loot-pickup') {
      const s = this.project(x, y, .3 + (this.reducedMotion ? 0 : age * .6));
      c.fillStyle = rarityInk(effect.item?.rarity);
      c.fillRect(s.x - 1, s.y - 2, 2, 4); c.fillRect(s.x - 2, s.y - 1, 4, 2);
    } else if (type === 'last-breath') {
      // A breath of light leaves the monk in .5 s, then a thin spirit ring holds while he is shielded.
      const hero = drawnAt(this, game.player), at = this.groundAnchor(hero.x, hero.y);
      if (age < .5) {
        const burst = age / .5;
        c.globalAlpha = 1 - burst;
        this.drawRing(at.x, at.y, .3 + burst * .9, .05, SPIRIT_LIGHT, 2);
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU + .2, r = .25 + burst * .35;
          const s = this.project(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, .3 + burst * (1.2 + (i % 3) * .3));
          c.fillStyle = i % 2 ? '#fff7e4' : SPIRIT_LIGHT; c.fillRect(s.x, s.y, 2, 2);
        }
      }
      if (this.breathShield(game.player)) {
        c.globalAlpha = this.reducedMotion ? .6 : .45 + .25 * Math.sin(age * 18);
        this.drawRing(at.x, at.y, .5, .05, SPIRIT, 1);
        this.drawRing(at.x, at.y, .42, .95, SPIRIT_LIGHT, 1, Math.PI * 1.1, Math.PI * 1.9);
      }
    }
  }

  // Retain exact screen projections and actor mask results. Static silhouettes
  // invalidate only their grid cells; an unchanged view/actor set skips the pass.
  updateOcclusion(game) {
    this.camera.getViewMatrix(true);
    this.scene.updateTransformMatrix(true);
    const transform = this.scene.getTransformMatrix(), scale = projectedSpriteScale(this.camera, this.height);
    const scratch = this.occlusionScratch ??= {
      point: new Vector3(), base: new Vector3(), origin: { x: 0, y: 0 }, viewport: new Viewport(0, 0, 1, 1),
      screen: new Matrix(), viewportMatrix: new Matrix(), transformValues: new Float32Array(16),
      actors: [], actorCount: 0, faded: [], fadedCount: 0, next: [], stops: [], changedProps: new Set(), restore: new Set(), frame: 0, query: 0,
    };
    if (!scratch.cleanup) {
      scratch.cleanup = () => { scratch.cancelObservation?.(); for (const stop of scratch.stops) stop(); scratch.stops.length = 0; };
      this.scene.onDisposeObservable.addOnce(scratch.cleanup);
    }
    this.camera.viewport.toGlobalToRef(this.width, this.height, scratch.viewport);
    const viewport = scratch.viewport;
    let viewChanged = !scratch.hasTransform || scratch.vx !== viewport.x || scratch.vy !== viewport.y || scratch.vw !== viewport.width || scratch.vh !== viewport.height;
    for (let k = 0; k < 16; k++) if (scratch.transformValues[k] !== transform.m[k]) { viewChanged = true; scratch.transformValues[k] = transform.m[k]; }
    if (viewChanged) {
      scratch.hasTransform = true; scratch.vx = viewport.x; scratch.vy = viewport.y; scratch.vw = viewport.width; scratch.vh = viewport.height;
      const halfZ = this.scene.getEngine().isNDCHalfZRange;
      Matrix.FromValuesToRef(viewport.width / 2, 0, 0, 0, 0, -viewport.height / 2, 0, 0, 0, 0, halfZ ? 1 : .5, 0,
        viewport.x + viewport.width / 2, viewport.height / 2 + viewport.y, halfZ ? 0 : .5, 1, scratch.viewportMatrix);
      // Match Vector3.ProjectToRef's Float32 products, including its identity step.
      Matrix.IdentityReadOnly.multiplyToRef(transform, scratch.screen);
      scratch.screen.multiplyToRef(scratch.viewportMatrix, scratch.screen);
      Vector3.TransformCoordinatesToRef(Vector3.ZeroReadOnly, scratch.screen, scratch.base);
    }
    const props = this.world.props;
    let changed = false;
    if (scratch.world !== this.world || scratch.width !== this.width || scratch.height !== this.height
      || scratch.scale !== scale || scratch.orthoTop !== this.camera.orthoTop || scratch.count !== props?.length) {
      scratch.cleanup(); scratch.changedProps.clear(); scratch.restore.clear();
      scratch.world = this.world; scratch.width = this.width; scratch.height = this.height;
      scratch.scale = scale; scratch.orthoTop = this.camera.orthoTop; scratch.count = props?.length;
      scratch.forward = this.camera.getForwardRay().direction;
      scratch.props = []; scratch.poll = new Set(); scratch.pollAlpha = new Set(); scratch.actors.length = 0; scratch.actorCount = 0;
      scratch.faded.length = scratch.next.length = scratch.fadedCount = 0; scratch.margin = 0;
      const all = props || [...this.world.columns, this.world.gate, this.world.shrine, ...this.world.fires.map(f => f.sprite)];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const sprite of all) {
        if (!sprite || sprite.mesh.renderingGroupId === 0 || sprite.noFade) continue;
        const mesh = sprite.mesh, atlas = sprite.atlas, size = atlas.frameSize;
        const width = size?.[0] ?? atlas.cell, height = size?.[1] ?? atlas.cell;
        const sx = Math.abs(mesh.scaling.x) * scale, sy = Math.abs(mesh.scaling.y) * scale;
        const half = Math.max(atlas.anchor[0], width - atlas.anchor[0]) * sx;
        Vector3.ProjectToRef(mesh.position, Matrix.IdentityReadOnly, transform, viewport, scratch.point);
        const p = { sprite, dx: scratch.point.x - scratch.base.x, dy: scratch.point.y - scratch.base.y,
          left: -half, right: half, top: -atlas.anchor[1] * sy, bottom: (height - atlas.anchor[1]) * sy,
          depth: Vector3.Dot(mesh.position, scratch.forward), covered: 0, tested: 0, frame: sprite.frame, flip: sprite.flip, cells: [], faded: false };
        scratch.props.push(p);
        // Poll until subscriptions have reconciled the last pre-install state.
        p.material = sprite.material;
        scratch.poll.add(p); scratch.pollAlpha.add(p);
        scratch.margin = Math.max(scratch.margin, half * 2, height * sy);
        minX = Math.min(minX, p.dx + p.left); maxX = Math.max(maxX, p.dx + p.right);
        minY = Math.min(minY, p.dy + p.top); maxY = Math.max(maxY, p.dy + p.bottom);
        scratch.writing = true;
        if (sprite.material.alpha !== 1) sprite.material.alpha = 1;
        if (sprite.material.transparencyMode !== Material.MATERIAL_ALPHATEST) sprite.material.transparencyMode = Material.MATERIAL_ALPHATEST;
        scratch.writing = false;
      }
      let observationIndex = 0;
      scratch.cancelObservation = scheduleStaticObservation(this.scene, () => {
        const p = scratch.props[observationIndex++];
        if (!p) return false;
        const bindOpacity = () => {
          p.opacityStop?.(); p.material = p.sprite.material;
          p.opacityStop = watchMaterialOpacity(p.material, () => { if (!scratch.writing) scratch.restore.add(p); });
          if (p.opacityStop) scratch.pollAlpha.delete(p); else scratch.pollAlpha.add(p);
        };
        bindOpacity();
        const stop = watchSpriteOcclusion(p.sprite, (_sprite, key) => {
          if (key === 'material') { bindOpacity(); scratch.restore.add(p); }
          else scratch.changedProps.add(p);
        });
        scratch.changedProps.add(p); scratch.restore.add(p);
        if (stop) scratch.poll.delete(p);
        scratch.stops.push(() => { stop?.(); p.opacityStop?.(); });
        return observationIndex < scratch.props.length;
      });
      scratch.minX = Math.floor(minX / 128); scratch.minY = Math.floor(minY / 128);
      scratch.cols = Math.max(0, Math.floor(maxX / 128) - scratch.minX + 1);
      scratch.rows = Math.max(0, Math.floor(maxY / 128) - scratch.minY + 1); scratch.grid = [];
      for (const p of scratch.props) {
        const x0 = Math.floor((p.dx + p.left) / 128) - scratch.minX, x1 = Math.floor((p.dx + p.right) / 128) - scratch.minX;
        const y0 = Math.floor((p.dy + p.top) / 128) - scratch.minY, y1 = Math.floor((p.dy + p.bottom) / 128) - scratch.minY;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const bucket = scratch.grid[y * scratch.cols + x] ??= { props: [], revision: 0 };
          bucket.props.push(p); p.cells.push(bucket);
        }
      }
      changed = true;
    }
    for (const p of scratch.poll) {
      if (p.frame !== p.sprite.frame || p.flip !== p.sprite.flip) scratch.changedProps.add(p);
      if (p.material !== p.sprite.material) {
        p.opacityStop?.(); p.material = p.sprite.material;
        p.opacityStop = watchMaterialOpacity(p.material, () => { if (!scratch.writing) scratch.restore.add(p); });
        if (p.opacityStop) scratch.pollAlpha.delete(p); else scratch.pollAlpha.add(p);
        scratch.restore.add(p);
      }
    }
    for (const p of scratch.changedProps) if (p.frame !== p.sprite.frame || p.flip !== p.sprite.flip) {
      p.frame = p.sprite.frame; p.flip = p.sprite.flip;
      for (const bucket of p.cells) bucket.revision++;
    }
    scratch.changedProps.clear();
    for (const p of scratch.pollAlpha) if (p.material.alpha !== (p.faded ? .25 : 1)
      || p.material.transparencyMode !== (p.faded ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST)) scratch.restore.add(p);
    const count = this.hounds.length + 1;
    for (let i = 0; i < count; i++) {
      let actor = scratch.actors[i];
      if (i && !(game.enemies[i - 1]?.hp > 0)) {
        if (actor?.active) { actor.active = false; changed = true; }
        continue;
      }
      const sprite = i ? this.hounds[i - 1].sprite : this.monk, mesh = sprite.mesh, atlas = sprite.atlas, position = mesh.position;
      actor ??= scratch.actors[i] = { origin: new Vector3(), covered: [], coveredCount: 0 };
      const projected = viewChanged || actor.sprite !== sprite || actor.mesh !== mesh || actor.px !== position.x || actor.py !== position.y || actor.pz !== position.z;
      if (projected) {
        Vector3.TransformCoordinatesToRef(position, scratch.screen, actor.origin);
        actor.px = position.x; actor.py = position.y; actor.pz = position.z;
        actor.depth = Vector3.Dot(position, scratch.forward);
      }
      if (projected || actor.atlas !== atlas || actor.sx !== mesh.scaling.x || actor.sy !== mesh.scaling.y) {
        const size = atlas.frameSize, sx = Math.abs(mesh.scaling.x) * scale, sy = Math.abs(mesh.scaling.y) * scale;
        const half = Math.max(atlas.anchor[0], (size?.[0] ?? atlas.cell) - atlas.anchor[0]) * sx;
        actor.left = -half + actor.origin.x; actor.right = half + actor.origin.x;
        actor.top = -atlas.anchor[1] * sy + actor.origin.y; actor.bottom = ((size?.[1] ?? atlas.cell) - atlas.anchor[1]) * sy + actor.origin.y;
      }
      actor.sprite = sprite; actor.mesh = mesh;
      if (i && (actor.right < -scratch.margin || actor.left > this.width + scratch.margin || actor.bottom < -scratch.margin || actor.top > this.height + scratch.margin)) {
        if (actor.active) changed = true;
        actor.active = false; actor.atlas = atlas; actor.sx = mesh.scaling.x; actor.sy = mesh.scaling.y; continue;
      }
      const x0 = Math.max(0, Math.floor((actor.left - scratch.base.x - .01) / 128) - scratch.minX);
      const x1 = Math.min(scratch.cols - 1, Math.floor((actor.right - scratch.base.x + .01) / 128) - scratch.minX);
      const y0 = Math.max(0, Math.floor((actor.top - scratch.base.y - .01) / 128) - scratch.minY);
      const y1 = Math.min(scratch.rows - 1, Math.floor((actor.bottom - scratch.base.y + .01) / 128) - scratch.minY);
      let revision = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) revision += scratch.grid[y * scratch.cols + x]?.revision ?? 0;
      actor.dirty = !actor.active || projected || actor.atlas !== atlas || actor.mask !== atlas.mask || actor.frame !== sprite.frame
        || actor.flip !== sprite.flip || actor.sx !== mesh.scaling.x || actor.sy !== mesh.scaling.y || actor.revision !== revision;
      if (actor.dirty) changed = true;
      actor.active = true; actor.atlas = atlas; actor.mask = atlas.mask; actor.frame = sprite.frame; actor.flip = sprite.flip;
      actor.sx = mesh.scaling.x; actor.sy = mesh.scaling.y; actor.revision = revision;
      actor.x0 = x0; actor.x1 = x1; actor.y0 = y0; actor.y1 = y1;
    }
    for (let i = count; i < scratch.actorCount; i++) {
      const actor = scratch.actors[i];
      if (actor?.active) changed = true;
      if (actor) { actor.active = false; actor.sprite = actor.mesh = actor.atlas = null; actor.coveredCount = 0; }
    }
    scratch.actorCount = count;
    if (!changed && !scratch.restore.size) return;
    const frame = ++scratch.frame, next = scratch.next; let nextCount = 0;
    for (let i = 0; i < count; i++) {
      const actor = scratch.actors[i];
      if (!actor?.active) continue;
      if (actor.dirty) {
        actor.coveredCount = 0;
        const query = ++scratch.query;
        for (let y = actor.y0; y <= actor.y1; y++) for (let x = actor.x0; x <= actor.x1; x++) {
          const bucket = scratch.grid[y * scratch.cols + x];
          if (!bucket) continue;
          for (const p of bucket.props) {
            if (p.tested === query) continue;
            p.tested = query;
            const front = scratch.origin;
            front.x = scratch.base.x + p.dx; front.y = scratch.base.y + p.dy;
            if (p.depth < actor.depth && front.x + p.left < actor.right && actor.left < front.x + p.right
              && front.y + p.top < actor.bottom && actor.top < front.y + p.bottom
              && obscuresSprite(p.sprite, front, actor.sprite, actor.origin, scale)) actor.covered[actor.coveredCount++] = p;
          }
        }
      }
      for (let j = 0; j < actor.coveredCount; j++) {
        const p = actor.covered[j];
        if (p.covered !== frame) { p.covered = frame; next[nextCount++] = p; }
      }
    }
    scratch.writing = true;
    try {
      for (let i = 0; i < scratch.fadedCount; i++) {
        const p = scratch.faded[i];
        if (p.covered !== frame) { p.faded = false; setMaterialOpacity(p.sprite.material, 1, Material.MATERIAL_ALPHATEST, Material); }
      }
      for (let i = 0; i < nextCount; i++) {
        const p = next[i]; p.faded = true;
        setMaterialOpacity(p.sprite.material, .25, Material.MATERIAL_ALPHABLEND, Material);
      }
      for (const p of scratch.restore) {
        const alpha = p.faded ? .25 : 1, mode = p.faded ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST;
        setMaterialOpacity(p.sprite.material, alpha, mode, Material);
      }
    } finally { scratch.writing = false; }
    scratch.restore.clear(); scratch.next = scratch.faded; scratch.faded = next; scratch.fadedCount = nextCount;
  }
  // The level-up light at the drawn monk's feet (level-up-fx.js). The projections reuse scratch objects.
  drawLevelUp() {
    const view = this.levelUpView ??= { x: 0, y: 0, unit: 0, rise: 0, reducedMotion: false,
      ground: new Vector3(), screen: new Vector3(), viewport: new Viewport(0, 0, 1, 1) };
    const p = this.monk.mesh.position, transform = this.scene.getTransformMatrix();
    this.camera.viewport.toGlobalToRef(this.width, this.height, view.viewport);
    view.ground.set(p.x, 0, p.z);
    Vector3.ProjectToRef(view.ground, Matrix.IdentityReadOnly, transform, view.viewport, view.screen);
    view.x = view.screen.x; view.y = view.screen.y;
    view.ground.y = 1;
    Vector3.ProjectToRef(view.ground, Matrix.IdentityReadOnly, transform, view.viewport, view.screen);
    view.rise = view.y - view.screen.y;
    view.unit = this.pixelsPerUnit();
    view.reducedMotion = this.reducedMotion;
    this.levelUpLight.draw(this.ctx, view);
  }

  drawRing(x, y, radius, height, hex, width, start = 0, end = TAU) {
    const c = this.ctx;
    c.beginPath();
    const count = 48;
    let scratch;
    for (let i = 0; i <= count; i++) {
      const a = start + (end - start) * i / count;
      const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
      if (!i || !scratch?.screen) {
        const p = this.project(px, py, height);
        if (!i) { scratch = this.projectionScratch; c.moveTo(p.x, p.y); }
        else c.lineTo(p.x, p.y);
      } else {
        // The camera cannot change during this path. Reuse its Float32 screen matrix
        // and Babylon's exact arithmetic without 48 viewport checks and point objects.
        Vector3.TransformCoordinatesFromFloatsToRef(px, height, py, scratch.screen, scratch.projected);
        c.lineTo(Math.round(scratch.projected.x), Math.round(scratch.projected.y));
      }
    }
    c.strokeStyle = hex; c.lineWidth = width; c.stroke();
  }

  drawOverlay(game, time, mode) {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    const unit = this.height / (this.camera.orthoTop * 2);
    c.lineCap = 'butt';
    // A few slow motes and rising embers keep the stone scene alive.
    c.globalCompositeOperation = 'screen';
    const hero = drawnAt(this, game.player);
    const bounds = game.world?.zones ? { minX: hero.x - 18, maxX: hero.x + 18,
      minY: hero.y - 18, maxY: hero.y + 18 } : this.world.bounds;
    for (let i = 0; i < (game.locationId === 'road' ? 90 : 45); i++) {
      const x = bounds.minX + seeded(i) * (bounds.maxX - bounds.minX);
      const y = bounds.minY + seeded(i + 66) * (bounds.maxY - bounds.minY);
      const h = ((time * .1 + seeded(i + 90) * 3) % 3) + .1;
      const s = this.project(x + Math.sin(time * .2 + i) * .2, y, h);
      if (s.x + 1 <= 0 || s.x >= this.width || s.y + 1 <= 0 || s.y >= this.height) continue;
      c.fillStyle = `rgba(190,170,206,${.13 + Math.sin(time + i) * .07})`;
      c.fillRect(s.x, s.y, 1, 1);
    }
    for (let j = 0; j < this.world.fires.length; j++) {
      const f = this.world.fires[j];
      const amber = f.color === 'amber';
      const glowOrigin = this.project(f.x, f.y, .2);
      // Canvas clips distant fires anyway; avoid allocating their unused gradients.
      const glowRadius = unit * 1.2;
      if (glowOrigin.x + glowRadius > 0 && glowOrigin.x - glowRadius < this.width
        && glowOrigin.y + glowRadius > 0 && glowOrigin.y - glowRadius < this.height) {
        const glow = c.createRadialGradient(glowOrigin.x, glowOrigin.y, 0, glowOrigin.x, glowOrigin.y, glowRadius);
        glow.addColorStop(0, amber ? '#e59a4328' : f.color === 'pink' ? '#ea64a012' : '#60e4d412');
        glow.addColorStop(1, '#00000000');
        c.fillStyle = glow; c.fillRect(glowOrigin.x - unit * 1.2, glowOrigin.y - unit * 1.2, unit * 2.4, unit * 2.4);
      }
      for (let i = 0; i < 5; i++) {
        const progress = (time * .45 + i / 5 + j * .17) % 1;
        const s = this.project(f.x + Math.sin(progress * 9 + i) * progress * .22, f.y, (amber ? .9 : 1.3) + progress * 1.3);
        c.globalAlpha = (1 - progress) * .7;
        c.fillStyle = amber ? '#ffd39a' : f.color === 'pink' ? '#ff769f' : '#9ffff0';
        c.fillRect(s.x, s.y, 1.4, 2.4);
      }
    }
    for (const drop of game.pickups ?? []) {
      const s = this.project(drop.x, drop.y, .12), radius = unit * .32;
      const glow = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
      glow.addColorStop(0, '#ffd09140'); glow.addColorStop(1, '#ffd09100');
      c.globalAlpha = 1; c.fillStyle = glow;
      c.fillRect(s.x - radius, s.y - radius, radius * 2, radius * 2);
    }
    if (game.groundItems?.length) this.drawGroundItems(game, time, unit);
    if (game.monkShots?.length || game.projectiles?.length) this.drawShotTrails(game);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (mode === 'welcome') return;
    if (game.player.technique) this.drawTechnique(game, hero, time);
    if (this.touchView) this.drawTouchView(game, hero);
    for (const portal of this.world.portals) {
      if (Math.hypot(hero.x - portal.x, hero.y - portal.y) > 4) continue;
      const s = this.project(portal.x, portal.y, .7);
      c.textAlign = 'center'; c.font = '8px monospace'; c.fillStyle = '#d7d2b9';
      c.fillText(portal.label.toUpperCase(), s.x, s.y);
    }
    for (const [i, e] of game.enemies.entries()) {
      if (e.hp <= 0) continue;
      const body = drawnAt(this, e);
      if (e.state === 'windup') {
        const ranged = e.kind === 'wraith';
        const progress = Math.min(1, Math.max(0, 1 - e.timer / windupDuration(e)));
        const shape = body === e ? e : { ...e, x: body.x, y: body.y };
        const points = warningShape(shape, game.world).map(p => this.project(p.x, p.y, .03));
        c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
        const color = ranged ? WRAITH_RGB : '255,101,140';
        c.fillStyle = `rgba(${color},${.06 + progress * .13})`; c.fill();
        c.lineWidth = 1; c.strokeStyle = `rgba(${color},${.35 + progress * .6})`; c.stroke();
        if (e.kind === 'beetle') {
          // The countdown fills the sector's clipped rim instead of a full ring around the shell.
          const filled = progress * SLAM_RAYS, whole = Math.min(SLAM_RAYS - 1, Math.floor(filled)), f = filled - whole;
          c.beginPath(); c.moveTo(points[0].x, points[0].y);
          for (let k = 1; k <= whole; k++) c.lineTo(points[k].x, points[k].y);
          c.lineTo(points[whole].x + (points[whole + 1].x - points[whole].x) * f, points[whole].y + (points[whole + 1].y - points[whole].y) * f);
          c.strokeStyle = '#ff477d'; c.lineWidth = 1.5; c.stroke();
        } else this.drawRing(body.x, body.y, .6, .035, ranged ? WRAITH_LIGHT : '#ff477d', 1.5, 0, progress * TAU);
      }
      const stand = e.kind === 'ritual' ? this.world.ritual?.standOn ?? 0 : 0;
      if (e.kind === 'ritual') {
        const s = this.project(e.x, e.y, 2.8 + stand);
        c.textAlign = 'center'; c.font = '8px monospace'; c.fillStyle = e.sealed ? '#d599b9' : '#b7f3e1';
        c.fillText(e.sealed ? 'ПЕЧАТЬ СТРАЖЕЙ' : 'ИСТОЧНИК ОТКРЫТ', s.x, s.y);
      }
      // Bars and flashes follow the drawn (blended, snapped) sprite, not its continuous body.
      const showBar = e.hp < e.maxHp || e.state === 'windup' || (e.kind === 'ritual' && !e.sealed);
      if (!showBar && !(this.presentation.hounds[i].flash > 0)) continue;
      const at = e.kind === 'ritual' ? body : this.groundAnchor(body.x, body.y);
      if (showBar) {
        const s = this.project(at.x, at.y, e.kind === 'ritual' ? 2.6 + stand : e.kind === 'wraith' ? 2 : e.kind === 'beetle' ? 1.75 : 1.55);
        c.fillStyle = '#17101ddb'; c.fillRect(s.x - 17, s.y, 34, 3);
        c.fillStyle = e.kind === 'hound' || !e.kind ? '#d86c9b' : e.kind === 'beetle' ? '#b9a3d6' : '#86cfc7'; c.fillRect(s.x - 17, s.y, 34 * e.hp / e.maxHp, 3);
      }
      if (this.presentation.hounds[i].flash > 0) {
        const s = this.project(at.x, at.y, .55 + stand);
        const grad = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, unit * .5);
        grad.addColorStop(0, `rgba(255,227,171,${this.presentation.hounds[i].flash * 3})`); grad.addColorStop(1, 'transparent');
        c.fillStyle = grad; c.fillRect(s.x - unit, s.y - unit, unit * 2, unit * 2);
      }
    }
    for (const effect of this.presentation.effects) {
      const { x, y, age, life, type } = effect;
      const fade = 1 - age / life;
      c.globalAlpha = fade;
      if (type === 'swing' && effect.weapon === 'staff' && this.monkShown?.weapon?.trail) {
        // The staff swing's own smear is in its drawing; afterimages mark the tips of its earlier keys.
        this.drawStaffTrail(this.monkShown.weapon, fade);
      } else if (type === 'swing') {
        // The arc follows the swing's weapon series; the staff's full-circle third sweeps all round.
        const a = Math.atan2(effect.dy, effect.dx), combo = attackCombo(effect);
        const i = Math.min(Math.max(0, effect.index ?? 0), combo.range.length - 1);
        const heavy = effect.strength ? effect.strength === 'heavy' : i === 2;
        const radius = combo.range[i] * (.8 + .2 * age / life), half = combo.dot[i] <= -1 ? Math.PI : Math.max(.85, Math.acos(combo.dot[i]) * .55);
        c.globalCompositeOperation = 'screen';
        this.drawRing(x, y, radius, .7, heavy ? '#ffd7a0' : '#ff876f', (heavy ? 3 : 2) * fade, a - half + age * 2, a + half - .05 + age * 2);
        this.drawRing(x, y, radius * .92, .53, '#fff2d4', 1.5 * fade, a - half * .6 + age * 2, a + half - .05 + age * 2);
      } else if (type === 'wave' || type === 'relic-wave' || type === 'crane-land') {
        // The crane's landing and the staff relic's small wave reuse the wave's rings and specks.
        const colors = type === 'relic-wave' ? [AMBER, '#ffe9bf', '#ffd597'] : ['#7cffe1', '#d4fff5', '#b3ffe9'];
        const radius = type === 'wave' ? MONK_RULES.wave.radius : effect.radius ?? 1.6;
        c.globalCompositeOperation = 'screen';
        this.drawRing(x, y, Math.min(radius, .2 + age * radius / .22), .1, colors[0], (type === 'wave' ? 4 : 3) * fade);
        this.drawRing(x, y, Math.min(radius * .92, .2 + age * radius / .3), .1, colors[1], 1.5 * fade);
        for (let i = 0; i < 18; i++) {
          const a = i / 18 * TAU, r = Math.min(radius, age * radius / .35);
          const s = this.project(x + Math.cos(a) * r, y + Math.sin(a) * r, .1);
          c.fillStyle = colors[2]; c.fillRect(s.x, s.y, 2, 2);
        }
      } else if (TECHNIQUE_EFFECTS.has(type)) {
        c.globalCompositeOperation = 'screen';
        this.drawTechniqueEffect(game, effect, fade);
      } else if (type === 'pickup') {
        const s = this.project(x, y, .3 + (this.reducedMotion ? 0 : age * .5));
        c.fillStyle = '#ffd091';
        c.fillRect(s.x - 1, s.y - 2, 2, 4); c.fillRect(s.x - 2, s.y - 1, 4, 2);
      } else if (type === 'ritual-open' || type === 'ritual-destroyed' || type === 'secret' || type === 'reward') {
        c.globalCompositeOperation = 'screen';
        const ritual = type.startsWith('ritual');
        this.drawRing(x, y, .45 + age * (ritual ? 2.4 : 1.2), .055, ritual ? '#9cebdd' : '#ffd597', 2 * fade);
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU;
          const s = this.project(x + Math.cos(a) * (.4 + age), y + Math.sin(a) * (.4 + age), .2 + age * .9);
          c.fillStyle = ritual ? '#acf7e8' : '#ffdf9f'; c.fillRect(s.x, s.y, 2, 2);
        }
      } else if (type === 'death') {
        c.globalCompositeOperation = 'screen';
        for (let i = 0; i < 20; i++) {
          const a = seeded(i + x * 11) * TAU, speed = .5 + seeded(i + y * 15) * 2.5;
          const h = Math.max(0, .5 + age * speed - age * age * 3);
          const s = this.project(x + Math.cos(a) * age * speed, y + Math.sin(a) * age * speed, h);
          const tail = this.project(x + Math.cos(a) * Math.max(0, age - .06) * speed, y + Math.sin(a) * Math.max(0, age - .06) * speed, h + .04);
          c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(tail.x, tail.y);
          c.strokeStyle = '#da8abf'; c.lineWidth = 1.8 * fade; c.stroke();
        }
      } else if (type === 'dash') {
        c.globalCompositeOperation = 'screen';
        for (let i = 0; i < 5; i++) {
          const shift = (i - 2) * .1;
          const s = this.project(x - effect.dy * shift, y + effect.dx * shift, .3 + i * .14);
          const distance = Math.min(MONK_RULES.dash.speed * MONK_RULES.dash.duration, age * MONK_RULES.dash.speed);
          const end = this.project(x + effect.dx * distance, y + effect.dy * distance, .3 + i * .14);
          c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(end.x, end.y); c.lineWidth = 1.8 * fade; c.strokeStyle = '#86e3d1'; c.stroke();
        }
      } else if (type === 'block') {
        // Sparks fly back along the incoming strike from the shell's face.
        const a = Math.atan2(-effect.dy, -effect.dx);
        c.globalCompositeOperation = 'screen';
        for (let i = 0; i < 7; i++) {
          const spread = a + (i - 3) * .32, r = .3 + age * 2.4;
          const s = this.project(x + Math.cos(spread) * r, y + Math.sin(spread) * r, .55 + age * .6);
          c.fillStyle = i % 2 ? '#e4dcf2' : '#fff7e4'; c.fillRect(s.x, s.y, 2, 2);
        }
      } else if (type === 'guard-break') {
        c.globalCompositeOperation = 'screen';
        this.drawRing(x, y, .4 + age * 1.6, .06, '#ff8f7a', 3 * fade);
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU + .3, r = .35 + age * 1.8;
          const s = this.project(x + Math.cos(a) * r, y + Math.sin(a) * r, .3 + age * 1.2);
          c.fillStyle = i % 2 ? '#b9a3d6' : '#ffb39e'; c.fillRect(s.x, s.y, 3, 2);
        }
      } else if (type === 'slam') {
        c.globalCompositeOperation = 'screen';
        const a = Math.atan2(effect.dy, effect.dx), reach = BEETLE_STATS.slamRange;
        this.drawRing(x, y, reach * (.55 + .45 * age / life), .04, '#ff477d', 3 * fade, a - 1.05, a + 1.05);
      } else if (type === 'damage') {
        c.globalAlpha = Math.min(1, fade * 2);
        const s = this.project(x, y, 1.8 + age * 1.1);
        c.font = `${effect.amount >= 40 ? 'bold 12px' : '10px'} monospace`;
        c.textAlign = 'center'; c.shadowBlur = 0;
        c.fillStyle = effect.blocked ? '#a59cb8' : effect.enemy ? '#fff2d8' : '#ff718e'; c.fillText(effect.enemy ? effect.amount : `−${effect.amount}`, s.x, s.y);
      }
      c.shadowBlur = 0; c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;
    this.weaponHits?.draw(c, this.projectionScratch?.screen?.m, unit, this.width, this.height, this.reducedMotion);
    if (game.groundItems?.length) this.drawGroundLabels(game);
    if (this.levelUpLight?.active) this.drawLevelUp();
    if (this.presentation.player.flash > 0 && !this.reducedMotion) {
      c.fillStyle = `rgba(160,20,48,${this.presentation.player.flash * .32})`; c.fillRect(0, 0, this.width, this.height);
    }
    if (!game.world && game.kills === game.enemies.length) {
      const s = this.project(legacyWorld.exit.x, legacyWorld.exit.y, 3.9);
      c.textAlign = 'center'; c.font = '10px Arial'; c.fillStyle = '#b3f2e3'; c.fillText('К ВОРОТАМ МОНАСТЫРЯ', s.x, s.y);
    }
  }

  // Phone terrain and the stone rim change only when the world or backing size changes.
  // Keep one atlas of static tiles; scrolling copies it under a cached pixel-disc clip.
  buildPhoneMap(game, width, height) {
    const world = game.world || legacyWorld, layout = adventureMapLayout(game, width, height);
    const scale = layout.scale, cell = Math.min(width, height) / MAP_CELLS;
    const left = (width - MAP_CELLS * cell) / 2, top = (height - MAP_CELLS * cell) / 2;
    const make = (w, h) => {
      const canvas = this.map.canvas.ownerDocument.createElement('canvas');
      canvas.width = w; canvas.height = h;
      return canvas;
    };
    const rim = make(width, height), c = rim.getContext('2d');
    const clipRows = new Float64Array((MAP_CELLS - MAP_RING * 2) * 4);
    const disc = (inset, face = 0) => {
      c.beginPath();
      const rows = pixelCircleRows(MAP_CELLS - inset * 2);
      for (let row = 0; row < rows.length; row++) {
        const half = rows[row], y = row + inset;
        const x0 = Math.round(left + (MAP_CELLS / 2 - half) * cell), x1 = Math.round(left + (MAP_CELLS / 2 + half) * cell);
        const y0 = Math.round(top + y * cell), y1 = Math.round(top + (y + 1) * cell);
        if (inset === MAP_RING) clipRows.set([x0, y0, x1 - x0, y1 - y0], row * 4);
        if ((face === 1 && y >= MAP_CELLS / 2) || (face === 2 && y < MAP_CELLS / 2)) continue;
        c.rect(x0, y0, x1 - x0, y1 - y0);
      }
      c.fill();
    };
    c.fillStyle = '#0d0a14'; disc(0);
    c.fillStyle = '#6c6179'; disc(1, 1);
    c.fillStyle = '#44394f'; disc(1, 2);
    c.fillStyle = '#120e1a'; disc(MAP_RING);
    let clip;
    if (typeof Path2D !== 'undefined') {
      clip = new Path2D();
      for (let i = 0; i < clipRows.length; i += 4) clip.rect(clipRows[i], clipRows[i + 1], clipRows[i + 2], clipRows[i + 3]);
    }
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const tile of world.tiles) {
      const u = tile.y - tile.x, v = (tile.x + tile.y) / 2;
      minU = Math.min(minU, u - 1); maxU = Math.max(maxU, u + 1);
      minV = Math.min(minV, v - .5); maxV = Math.max(maxV, v + .5);
    }
    const originX = Math.floor(minU * scale) - 1, originY = Math.floor(minV * scale) - 1;
    const terrain = make(Math.ceil(maxU * scale) - originX + 2, Math.ceil(maxV * scale) - originY + 2), t = terrain.getContext('2d');
    for (const tile of world.tiles) {
      const x = (tile.y - tile.x) * scale - originX, y = (tile.x + tile.y) / 2 * scale - originY;
      t.beginPath(); t.moveTo(x, y - scale / 2); t.lineTo(x + scale, y);
      t.lineTo(x, y + scale / 2); t.lineTo(x - scale, y); t.closePath();
      const zoneId = world.zones ? getOverworldZone(tile.x, tile.y).id : world.id;
      t.fillStyle = ZONE_TILE_COLORS[zoneId] ?? '#a590b435'; t.fill();
      t.strokeStyle = '#b7a79329'; t.lineWidth = .5; t.stroke();
    }
    const markers = world.portals.map(p => ({ ...p, kind: 'portal' }));
    for (const shrine of shrinesOf(world)) markers.push({ ...shrine, kind: 'shrine' });
    for (const cache of cachesOf(world)) markers.push({ ...cache, kind: 'secret' });
    if (world.reward) markers.push({ ...world.reward, kind: 'reward' });
    if (!game.world) markers.push({ ...world.exit, kind: 'portal' });
    const p = layout.project(0, 0);
    this.phoneMap = { world, width, height, scale, rim, terrain, clip, clipRows, originX, originY, markers,
      radius: layout.radius, centerU: (width / 2 - p.x) / scale, centerV: (height / 2 - p.y) / scale };
    return this.phoneMap;
  }

  drawPhoneMap(game) {
    const c = this.map, width = c.canvas.width, height = c.canvas.height, world = game.world || legacyWorld;
    const m = this.phoneMap?.world === world && this.phoneMap.width === width && this.phoneMap.height === height
      ? this.phoneMap : this.buildPhoneMap(game, width, height);
    const hero = drawnAt(this, game.player), scale = m.scale;
    const centerU = world.zones ? hero.y - hero.x : m.centerU, centerV = world.zones ? (hero.x + hero.y) / 2 : m.centerV;
    const cx = width / 2, cy = height / 2, offsetX = cx - centerU * scale, offsetY = cy - centerV * scale;
    const reach = m.radius - Math.max(4, scale), reach2 = reach * reach;
    c.clearRect(0, 0, width, height); c.drawImage(m.rim, 0, 0); c.save();
    if (m.clip) c.clip(m.clip);
    else {
      c.beginPath();
      for (let i = 0; i < m.clipRows.length; i += 4) c.rect(m.clipRows[i], m.clipRows[i + 1], m.clipRows[i + 2], m.clipRows[i + 3]);
      c.clip();
    }
    c.drawImage(m.terrain, m.originX + offsetX, m.originY + offsetY);
    for (let i = 0; i < game.enemies.length; i++) {
      const e = game.enemies[i], body = drawnAt(this, e);
      if (e.hp <= 0) continue;
      const x = (body.y - body.x) * scale + offsetX, y = (body.x + body.y) / 2 * scale + offsetY;
      if (world.zones && (x - cx) ** 2 + (y - cy) ** 2 > reach2) continue;
      if (e.kind === 'ritual') {
        c.strokeStyle = e.sealed ? '#d075b0' : '#a8f2d9'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.stroke();
      } else {
        c.fillStyle = e.kind === 'wraith' ? '#a5e8e0' : e.kind === 'beetle' ? '#b9a3d6' : '#d56593';
        c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill();
      }
    }
    for (let i = 0; i < m.markers.length; i++) {
      const marker = m.markers[i], x = (marker.y - marker.x) * scale + offsetX, y = (marker.x + marker.y) / 2 * scale + offsetY;
      if (world.zones && (x - cx) ** 2 + (y - cy) ** 2 > reach2) continue;
      const used = marker.kind === 'secret' ? cacheFound(game, marker.id) : marker.kind === 'shrine' ? shrineUsed(game, marker.id)
        : marker.kind === 'reward' && game.adventure?.rewardCollected;
      c.globalAlpha = used ? .3 : 1; c.lineWidth = 1.5;
      if (marker.kind === 'portal') {
        c.strokeStyle = '#bce6cf'; c.beginPath(); c.moveTo(x - 4, y + 4); c.lineTo(x, y - 4); c.lineTo(x + 4, y + 4); c.stroke();
      } else if (marker.kind === 'shrine') {
        c.strokeStyle = '#72bfbc'; c.strokeRect(x - 3, y - 3, 6, 6);
      } else if (marker.kind === 'secret') {
        const pulse = used || this.reducedMotion ? 0 : (1 - Math.cos((this.presentation?.time ?? 0) * TAU / 1.6)) / 2;
        c.strokeStyle = used ? '#8a9b91' : '#92faf1'; c.lineWidth = 1 + pulse;
        c.strokeRect(x - 5 - pulse, y - 4 - pulse, 10 + pulse * 2, 8 + pulse * 2);
        c.fillStyle = used ? '#8a9b91' : '#e6fffb'; c.fillRect(x - 3, y - 2, 6, 4);
      } else {
        c.strokeStyle = '#eec688'; c.beginPath(); c.arc(x, y, 3.5, 0, TAU); c.stroke();
      }
    }
    c.globalAlpha = 1;
    if (game.groundItems) for (let i = 0; i < game.groundItems.length; i++) {
      const ground = game.groundItems[i], x = (ground.y - ground.x) * scale + offsetX, y = (ground.x + ground.y) / 2 * scale + offsetY;
      if (world.zones && (x - cx) ** 2 + (y - cy) ** 2 > reach2) continue;
      c.fillStyle = NIGHT; c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
      c.fillStyle = lootLightState(ground.item?.rarity, 0).color; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }
    const x = (hero.y - hero.x) * scale + offsetX, y = (hero.x + hero.y) / 2 * scale + offsetY;
    c.shadowColor = '#b4f3d9'; c.shadowBlur = 7; c.fillStyle = '#dcf7dd';
    c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill(); c.shadowBlur = 0; c.restore();
  }

  drawMap(game) {
    if (this.coarsePointer) return this.drawPhoneMap(game);
    const c = this.map, world = game.world || legacyWorld;
    const width = c.canvas?.width || 360, height = c.canvas?.height || 280;
    // The map centres on the drawn monk, so it scrolls as evenly as the scene.
    const hero = drawnAt(this, game.player);
    const view = hero === game.player ? game : { ...game, player: { ...game.player, x: hero.x, y: hero.y } };
    const { project, scale, markers, tiles, visible } = adventureMapLayout(view, width, height);
    // The pixel disc in whole cells; the plate under the circle names the zone and lists the strip.
    const cell = Math.min(width, height) / MAP_CELLS;
    const left = (width - MAP_CELLS * cell) / 2, top = (height - MAP_CELLS * cell) / 2;
    const disc = (inset, rows = () => true) => {
      c.beginPath();
      pixelCircleRows(MAP_CELLS - 2 * inset).forEach((half, row) => {
        if (!rows(row + inset)) return;
        const x0 = Math.round(left + (MAP_CELLS / 2 - half) * cell), x1 = Math.round(left + (MAP_CELLS / 2 + half) * cell);
        const y0 = Math.round(top + (row + inset) * cell), y1 = Math.round(top + (row + inset + 1) * cell);
        c.rect(x0, y0, x1 - x0, y1 - y0);
      });
    };
    c.clearRect(0, 0, width, height);
    // The ring as the HUD frames: a night outline, a light upper bevel and a darker lower face.
    c.fillStyle = '#0d0a14'; disc(0); c.fill();
    c.fillStyle = '#6c6179'; disc(1, row => row < MAP_CELLS / 2); c.fill();
    c.fillStyle = '#44394f'; disc(1, row => row >= MAP_CELLS / 2); c.fill();
    c.fillStyle = '#120e1a'; disc(MAP_RING); c.fill();
    c.save();
    disc(MAP_RING); c.clip();
    for (const tile of tiles) {
      const p = project(tile.x, tile.y);
      c.beginPath(); c.moveTo(p.x, p.y - scale / 2); c.lineTo(p.x + scale, p.y);
      c.lineTo(p.x, p.y + scale / 2); c.lineTo(p.x - scale, p.y); c.closePath();
      const zoneId = world.zones ? getOverworldZone(tile.x, tile.y).id : world.id;
      c.fillStyle = ZONE_TILE_COLORS[zoneId] ?? '#a590b435';
      c.fill(); c.strokeStyle = '#b7a79329'; c.lineWidth = .5; c.stroke();
    }
    for (const e of game.enemies) {
      const body = drawnAt(this, e);
      if (e.hp <= 0 || !visible(body.x, body.y)) continue;
      const p = project(body.x, body.y);
      if (e.kind === 'ritual') {
        c.strokeStyle = e.sealed ? '#d075b0' : '#a8f2d9'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(p.x, p.y - 5); c.lineTo(p.x + 5, p.y); c.lineTo(p.x, p.y + 5);
        c.lineTo(p.x - 5, p.y); c.closePath(); c.stroke();
      } else {
        c.fillStyle = e.kind === 'wraith' ? '#a5e8e0' : e.kind === 'beetle' ? '#b9a3d6' : '#d56593';
        c.beginPath(); c.arc(p.x, p.y, 2.6, 0, TAU); c.fill();
      }
    }
    for (const marker of markers) {
      const p = project(marker.x, marker.y);
      c.globalAlpha = marker.used ? .3 : 1;
      c.lineWidth = 1.5;
      if (marker.kind === 'portal') {
        c.strokeStyle = '#bce6cf';
        c.beginPath(); c.moveTo(p.x - 4, p.y + 4); c.lineTo(p.x, p.y - 4); c.lineTo(p.x + 4, p.y + 4); c.stroke();
      } else if (marker.kind === 'shrine') {
        c.strokeStyle = '#72bfbc'; c.strokeRect(p.x - 3, p.y - 3, 6, 6);
      } else if (marker.kind === 'secret') {
        const pulse = marker.used || this.reducedMotion ? 0 : (1 - Math.cos((this.presentation?.time ?? 0) * TAU / 1.6)) / 2;
        c.strokeStyle = marker.used ? '#8a9b91' : '#92faf1';
        c.lineWidth = 1 + pulse;
        c.strokeRect(p.x - 5 - pulse, p.y - 4 - pulse, 10 + pulse * 2, 8 + pulse * 2);
        c.fillStyle = marker.used ? '#8a9b91' : '#e6fffb'; c.fillRect(p.x - 3, p.y - 2, 6, 4);
      } else {
        c.strokeStyle = '#eec688'; c.beginPath(); c.arc(p.x, p.y, 3.5, 0, TAU); c.stroke();
      }
    }
    c.globalAlpha = 1;
    for (const ground of game.groundItems ?? []) {
      if (!visible(ground.x, ground.y)) continue;
      const p = project(ground.x, ground.y);
      c.fillStyle = NIGHT; c.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5);
      c.fillStyle = lootLightState(ground.item?.rarity, 0).color;
      c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
    }
    const p = project(hero.x, hero.y);
    c.shadowColor = '#b4f3d9'; c.shadowBlur = 7; c.fillStyle = '#dcf7dd';
    c.beginPath(); c.arc(p.x, p.y, 4, 0, TAU); c.fill(); c.shadowBlur = 0;
    c.restore();
  }
}
