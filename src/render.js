import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import '@babylonjs/core/Culling/ray.js';
import { loadPixelAssets, createSprite, disposeSprite, setSpriteFrame, setGroundEffectDirection, createShadow, buildPixelWorld,
  SpriteAppearance, loadAppearanceTexture, legacyWorld, pixelAssetUrls, PIXELS_PER_UNIT } from './pixel-scene.js';
import { monkPose, houndPose, wraithPose, beetlePose, worldPose, effectPose, PresentationState } from './pixel-animation.js';
import { opaqueSpritePixel, obscuresSprite } from './pixel-picking.js';
import { isWalkable, clearLine } from './world.js';
import { WRAITH_TIMINGS, WRAITH_STATS, BEETLE_TIMINGS, BEETLE_STATS } from './campaign.js';
import { appearanceVariant } from './appearance.js';
import { MONK_RULES } from './monk-combat.js';
import { getOverworldZone } from './overworld.js';

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
};

export function warningLength(enemy, world) {
  const ranged = enemy.kind === 'wraith';
  const maximum = ranged ? WRAITH_STATS.shotSpeed * WRAITH_STATS.shotLife : 2.9;
  const radius = ranged ? WRAITH_STATS.shotRadius : .29;
  let length = 0;
  for (let distance = .12; distance <= maximum; distance += .12) {
    if (!isWalkable(enemy.x + enemy.dx * distance, enemy.y + enemy.dy * distance, radius, world)) break;
    length = distance;
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

export function adventureMapLayout(game, width = 360, height = 280) {
  const world = game.world || legacyWorld;
  let centerU, centerV, scale;
  if (world.zones) {
    const p = game.player ?? world.spawn;
    centerU = p.y - p.x; centerV = (p.x + p.y) / 2;
    scale = Math.min((width - 24) / 48, (height - 64) / 32, 8);
  } else {
    const us = world.tiles.map(p => p.y - p.x), vs = world.tiles.map(p => (p.x + p.y) / 2);
    const minU = Math.min(...us) - 1, maxU = Math.max(...us) + 1;
    const minV = Math.min(...vs) - .5, maxV = Math.max(...vs) + .5;
    centerU = (minU + maxU) / 2; centerV = (minV + maxV) / 2;
    scale = Math.min((width - 24) / (maxU - minU), (height - 64) / (maxV - minV), 12);
  }
  const project = (x, y) => ({ x: width / 2 + (y - x - centerU) * scale,
    y: 34 + (height - 64) / 2 + ((x + y) / 2 - centerV) * scale });
  const visible = (x, y) => {
    if (!world.zones) return true;
    const p = project(x, y), margin = Math.max(6, scale);
    return p.x >= 12 + margin && p.x <= width - 12 - margin && p.y >= 34 + margin && p.y <= height - 30 - margin;
  };
  const markers = world.portals.map(p => ({ ...p, kind: 'portal' }));
  if (world.shrine) markers.push({ ...world.shrine, kind: 'shrine', used: game.shrineUsed });
  if (world.secret) markers.push({ ...world.secret, kind: 'secret', used: game.adventure?.secretFound });
  if (world.reward) markers.push({ ...world.reward, kind: 'reward', used: game.adventure?.rewardCollected });
  if (!game.world) markers.push({ ...world.exit, kind: 'portal' });
  const p = game.player ?? world.spawn;
  const title = world.zones ? getOverworldZone(p.x, p.y).title : world.title;
  return { project, scale, visible, title, tiles: world.tiles.filter(p => visible(p.x, p.y)),
    markers: markers.filter(p => visible(p.x, p.y)) };
}

export class Renderer {
  constructor(canvas, effectsCanvas, mapCanvas, game) {
    this.game = game;
    this.presentation = new PresentationState(game);
    this.fxSprites = new Map();
    this.canvas = canvas;
    this.overlay = effectsCanvas;
    this.ctx = effectsCanvas.getContext('2d');
    this.map = mapCanvas.getContext('2d');
    this.engine = new Engine(canvas, false, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'low-power' }, false);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#191523ff');
    this.scene.skipPointerMovePicking = true;
    this.camera = new ArcRotateCamera('isometric', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 1.2), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = .1; this.camera.maxZ = 100;
    this.camera.inputs.clear();
    this.followTarget = this.camera.target.clone();
    this.assets = loadPixelAssets(this.scene);
    this.world = buildPixelWorld(this.scene, this.assets, game.world);
    this.locationRevision = game.locationRevision;
    this.monk = createSprite(this.scene, 'monk', this.assets.monk);
    this.monkShadow = createShadow(this.scene, 'monk-shadow', SHADOWS.monk.radius, SHADOWS.monk);
    this.hounds = game.enemies.map(e => this.createEnemy(e));
    this.projectiles = new Map();
    this.pickups = new Map();
    this.appearanceController = new SpriteAppearance(this.monk, url => loadAppearanceTexture(this.scene, url));
    this.scene.onDisposeObservable.add(() => this.appearanceController.dispose());
    this.monk.mesh.setEnabled(false);
    this.ready = this.assets.ready;
    // Initial appearance failures remain recoverable through the same UI/API as
    // later selections; only common asset failures reject renderer readiness.
    this.updateAppearance(game).catch(() => {});
    this.shake = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    this.snapCamera(game);
  }

  createEnemy(enemy) {
    const kind = enemy.kind || 'hound';
    const atlas = kind === 'ritual' ? this.assets.world : this.assets[kind];
    const sprite = createSprite(this.scene, `${kind}-${enemy.id}`, atlas,
      kind === 'ritual' ? atlas.clips.shrine.front[0] : 0);
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
      this.locationRevision = game.locationRevision;
      this.snapCamera(game);
    }
    // Object identity also covers a replacement within a location. Preserve views
    // through reorderings, never attach an old warning/death pose by array index.
    const existing = new Set(this.hounds);
    this.hounds = game.enemies.map(enemy => {
      const view = this.hounds.find(h => (h.body === enemy || (!h.body && h.id === enemy.id)) && h.kind === (enemy.kind || 'hound'));
      if (view) { existing.delete(view); view.body = enemy; return view; }
      return this.createEnemy(enemy);
    });
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
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const scale = Math.max(2, Math.floor(Math.min(viewportWidth / 640, viewportHeight / 360)));
    const displayWidth = Math.floor(viewportWidth / scale) * scale;
    const displayHeight = Math.floor(viewportHeight / scale) * scale;
    // Leave at most scale-1 pixels at the edge instead of stretching individual pixels.
    for (const canvas of [this.canvas, this.overlay]) {
      Object.assign(canvas.style, {
        width: `${displayWidth}px`, height: `${displayHeight}px`,
        left: `${Math.floor((viewportWidth - displayWidth) / 2)}px`,
        top: `${Math.floor((viewportHeight - displayHeight) / 2)}px`,
        right: 'auto', bottom: 'auto',
      });
    }
    this.engine.setHardwareScalingLevel(scale);
    this.engine.resize();
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
    shadow.position.set(anchor.x - shift, height, anchor.y + shift);
  }

  project(x, y, height = 0) {
    const v = Vector3.Project(new Vector3(x, height, y), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.width, this.height));
    return { x: Math.round(v.x), y: Math.round(v.y) };
  }

  // `motion` blends bodies between simulation steps; without it they draw as they are.
  render(game, dt, mode = 'playing', motion = null) {
    this.syncLocation(game);
    this.game = game;
    this.motion = motion;
    // The controller owns errors and revision checks; the UI reads its status.
    this.updateAppearance(game).catch(() => {});
    dt = this.presentation.update(game, dt, mode);
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
            : event.type === 'guard-break' ? .09 : event.type === 'slam' ? .05 : event.type === 'block' ? .02
            : event.type === 'impact' ? event.strength === 'heavy' ? .08 : .025 : 0;
          this.shake = Math.max(this.shake, impulse);
        }
      }
      stableTarget.x += Math.sin(t * 80) * this.shake;
      stableTarget.z += Math.cos(t * 67) * this.shake;
    } else this.shake = 0;
    this.camera.target.copyFrom(stableTarget);

    setSpriteFrame(this.monk, monkPose(p, this.assets.monk, this.presentation.player));
    this.monk.mesh.position.set(anchor.x, .025, anchor.y);
    const playerFlash = this.presentation.player.flash > 0;
    this.monk.material.emissiveColor.set(1, playerFlash ? .5 : 1, playerFlash ? .6 : 1);
    this.placeShadow(this.monkShadow, anchor, SHADOWS.monk, this.monk.flip, .023);
    const lift = ELEVATION * this.pixelsPerUnit();
    for (let i = 0; i < this.hounds.length; i++) {
      const e = game.enemies[i], { sprite, shadow } = this.hounds[i];
      if (e.kind === 'ritual') {
        const frames = this.assets.world.clips.shrine.front;
        setSpriteFrame(sprite, { frame: frames[e.hp <= 0 ? 5 : e.sealed ? 0 : 2 + Math.floor(t * 4) % 3], flip: false });
        sprite.mesh.visibility = e.hp <= 0 ? .38 : 1;
        sprite.material.emissiveColor.set(e.sealed ? .85 : .55, e.sealed ? .55 : 1, 1);
      } else setSpriteFrame(sprite, (e.kind === 'wraith' ? wraithPose : e.kind === 'beetle' ? beetlePose : houndPose)(e, sprite.atlas, this.presentation.hounds[i]));
      // The leap height also lands on whole screen pixels.
      const jump = e.state === 'leap' ? Math.round(Math.sin((1 - e.timer / .27) * Math.PI) * .25 * lift) / lift : 0;
      // The shrine pedestal's contact diamond is centered at source pixel 124,
      // above the shared world-atlas anchor 144. Register it to the ground seal.
      const contactOffset = e.kind === 'ritual'
        ? Math.SQRT2 * ((sprite.atlas.anchor[1] - 124) / PIXELS_PER_UNIT + .025 * Math.sin(Math.PI / 3)) : 0;
      const body = drawnAt(this, e), at = e.kind === 'ritual' ? body : this.groundAnchor(body.x, body.y);
      sprite.mesh.position.set(at.x + contactOffset, .025 + jump, at.y + contactOffset);
      const flash = this.presentation.hounds[i].flash > 0;
      if (e.kind !== 'ritual' || flash) sprite.material.emissiveColor.set(1, flash ? .55 : 1, flash ? .7 : 1);
      this.placeShadow(shadow, at, SHADOWS[e.kind] ?? SHADOWS.hound, sprite.flip, .024);
      // A leaping hound's shadow shrinks and fades a little with its height.
      shadow.scaling.setAll(1 - jump * .8);
      shadow.visibility = e.hp > 0 ? 1 - jump * 1.4 : .3;
    }
    for (let i = 0; i < this.world.fires.length; i++) {
      const fire = this.world.fires[i];
      if (fire.sprite?.atlas === this.assets.campFlame) {
        const { frames, frameDurationMs } = fire.sprite.atlas.animation;
        const key = frames[Math.floor(t * 1000 / frameDurationMs) % frames.length];
        setSpriteFrame(fire.sprite, { frame: fire.sprite.atlas.frames.indexOf(key), flip: fire.sprite.flip });
      } else if (fire.sprite) setSpriteFrame(fire.sprite, worldPose(fire.clip, this.assets.world, this.presentation, i * .13));
      for (const [j, flame] of (fire.flames || []).entries()) {
        flame.scaling.y = 1 + Math.sin(t * 7 + j * 2) * .12;
        flame.rotation.y = Math.floor(t * 6 + j) * .35;
      }
    }
    if (this.world.shrine) setSpriteFrame(this.world.shrine, worldPose('shrine', this.assets.world, this.presentation));
    if (this.world.gate?.atlas.clips?.gate) setSpriteFrame(this.world.gate, worldPose('gate', this.world.gate.atlas, this.presentation));
    this.updateLocationState(game, t);
    this.updateEffects(game);
    this.updateProjectiles(game, t);
    this.updatePickups(game, t);
    this.updateOcclusion(game);
    this.scene.render();
    this.drawOverlay(game, t, mode);
    this.drawMap(game);
  }

  updateLocationState(game, time) {
    const world = this.world;
    if (world.secret) {
      world.secret.lid.rotation.x = game.adventure?.secretFound ? -.7 : 0;
      world.secret.ring.isVisible = !game.adventure?.secretFound;
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

  updateProjectiles(game, time) {
    this.projectiles ??= new Map();
    const active = new Set();
    for (const shot of game.projectiles || []) {
      active.add(shot.id);
      let view = this.projectiles.get(shot.id);
      if (!view) {
        const mesh = MeshBuilder.CreateSphere(`spirit-shot-${shot.id}`, { diameter: shot.radius * 2, segments: 3 }, this.scene);
        const material = new StandardMaterial(`shot-ink-${shot.id}`, this.scene);
        material.disableLighting = true;
        material.emissiveColor = Color3.FromHexString('#a7f7ee'); material.diffuseColor = material.emissiveColor;
        material.specularColor = Color3.Black(); mesh.material = material; mesh.isPickable = false;
        mesh.renderingGroupId = 1;
        const shadow = createShadow(this.scene, `shot-shadow-${shot.id}`, SHADOWS.shot.radius, SHADOWS.shot);
        view = { mesh, shadow }; this.projectiles.set(shot.id, view);
      }
      const body = drawnAt(this, shot), at = this.groundAnchor(body.x, body.y);
      view.mesh.position.set(at.x, .65, at.y);
      view.mesh.rotation.set(time * 2, Math.atan2(shot.dx, shot.dy), Math.PI / 4);
      view.mesh.scaling.set(1, 1.3 + Math.sin(time * 12) * .12, 1);
      this.placeShadow(view.shadow, at, SHADOWS.shot, false, .026);
    }
    for (const [id, view] of this.projectiles) if (!active.has(id)) {
      this.disposeProjectile(view); this.projectiles.delete(id);
    }
  }

  disposeProjectile(view) {
    for (const mesh of [view.mesh, view.shadow]) { const material = mesh.material; mesh.dispose(); material.dispose(); }
  }

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

  updateEffects(game) {
    const active = new Set();
    for (const event of this.presentation.effects) {
      const name = event.type === 'heal' ? 'healing' : event.type;
      if (name !== 'impact' && name !== 'healing') continue;
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
        warning.material.emissiveColor.set(enemy.kind === 'wraith' ? .5 : 1, 1, 1);
      }
    }
  }

  updateOcclusion(game) {
    this.camera.getViewMatrix(true);
    this.scene.updateTransformMatrix(true);
    const transform = this.scene.getTransformMatrix();
    const viewport = this.camera.viewport.toGlobal(this.width, this.height);
    const spriteScale = projectedSpriteScale(this.camera, this.height);
    const forward = this.camera.getForwardRay().direction;
    const actors = [this.monk, ...this.hounds.filter((_, i) => game.enemies[i].hp > 0).map(h => h.sprite)]
      .map(sprite => ({ sprite, origin: Vector3.Project(sprite.mesh.position, Matrix.Identity(), transform, viewport),
        depth: Vector3.Dot(sprite.mesh.position, forward) }));
    const props = (this.world.props || [...this.world.columns, this.world.gate, this.world.shrine, ...this.world.fires.map(f => f.sprite)]).filter(Boolean);
    for (const sprite of props) {
      if (sprite.mesh.renderingGroupId === 0) continue;
      const origin = Vector3.Project(sprite.mesh.position, Matrix.Identity(), transform, viewport);
      const depth = Vector3.Dot(sprite.mesh.position, forward);
      const covered = actors.some(actor => depth < actor.depth &&
        obscuresSprite(sprite, origin, actor.sprite, actor.origin, spriteScale));
      sprite.material.alpha = covered ? .25 : 1;
      sprite.material.transparencyMode = covered ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST;
    }
  }
  drawRing(x, y, radius, height, hex, width, start = 0, end = TAU) {
    const c = this.ctx;
    c.beginPath();
    const count = 48;
    for (let i = 0; i <= count; i++) {
      const a = start + (end - start) * i / count;
      const p = this.project(x + Math.cos(a) * radius, y + Math.sin(a) * radius, height);
      if (!i) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
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
      c.fillStyle = `rgba(190,170,206,${.13 + Math.sin(time + i) * .07})`;
      c.fillRect(s.x, s.y, 1, 1);
    }
    for (let j = 0; j < this.world.fires.length; j++) {
      const f = this.world.fires[j];
      const amber = f.color === 'amber';
      const glowOrigin = this.project(f.x, f.y, .2);
      const glow = c.createRadialGradient(glowOrigin.x, glowOrigin.y, 0, glowOrigin.x, glowOrigin.y, unit * 1.2);
      glow.addColorStop(0, amber ? '#e59a4328' : f.color === 'pink' ? '#ea64a012' : '#60e4d412');
      glow.addColorStop(1, '#00000000');
      c.fillStyle = glow; c.fillRect(glowOrigin.x - unit * 1.2, glowOrigin.y - unit * 1.2, unit * 2.4, unit * 2.4);
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
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (mode === 'welcome') return;
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
        const color = ranged ? '111,229,218' : '255,101,140';
        c.fillStyle = `rgba(${color},${.06 + progress * .13})`; c.fill();
        c.lineWidth = 1; c.strokeStyle = `rgba(${color},${.35 + progress * .6})`; c.stroke();
        if (e.kind === 'beetle') {
          // The countdown fills the sector's clipped rim instead of a full ring around the shell.
          const filled = progress * SLAM_RAYS, whole = Math.min(SLAM_RAYS - 1, Math.floor(filled)), f = filled - whole;
          c.beginPath(); c.moveTo(points[0].x, points[0].y);
          for (let k = 1; k <= whole; k++) c.lineTo(points[k].x, points[k].y);
          c.lineTo(points[whole].x + (points[whole + 1].x - points[whole].x) * f, points[whole].y + (points[whole + 1].y - points[whole].y) * f);
          c.strokeStyle = '#ff477d'; c.lineWidth = 1.5; c.stroke();
        } else this.drawRing(body.x, body.y, .6, .035, ranged ? '#a4f8e9' : '#ff477d', 1.5, 0, progress * TAU);
      }
      if (e.kind === 'ritual') {
        const s = this.project(e.x, e.y, 2.8);
        c.textAlign = 'center'; c.font = '8px monospace'; c.fillStyle = e.sealed ? '#d599b9' : '#b7f3e1';
        c.fillText(e.sealed ? 'ПЕЧАТЬ СТРАЖЕЙ' : 'ИСТОЧНИК ОТКРЫТ', s.x, s.y);
      }
      // Bars and flashes follow the drawn (blended, snapped) sprite, not its continuous body.
      const at = e.kind === 'ritual' ? body : this.groundAnchor(body.x, body.y);
      if (e.hp < e.maxHp || e.state === 'windup' || (e.kind === 'ritual' && !e.sealed)) {
        const s = this.project(at.x, at.y, e.kind === 'ritual' ? 2.6 : e.kind === 'wraith' ? 2 : e.kind === 'beetle' ? 1.75 : 1.55);
        c.fillStyle = '#17101ddb'; c.fillRect(s.x - 17, s.y, 34, 3);
        c.fillStyle = e.kind === 'hound' || !e.kind ? '#d86c9b' : e.kind === 'beetle' ? '#b9a3d6' : '#86cfc7'; c.fillRect(s.x - 17, s.y, 34 * e.hp / e.maxHp, 3);
      }
      if (this.presentation.hounds[i].flash > 0) {
        const s = this.project(at.x, at.y, .55);
        const grad = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, unit * .5);
        grad.addColorStop(0, `rgba(255,227,171,${this.presentation.hounds[i].flash * 3})`); grad.addColorStop(1, 'transparent');
        c.fillStyle = grad; c.fillRect(s.x - unit, s.y - unit, unit * 2, unit * 2);
      }
    }
    for (const effect of this.presentation.effects) {
      const { x, y, age, life, type } = effect;
      const fade = 1 - age / life;
      c.globalAlpha = fade;
      if (type === 'swing') {
        const a = Math.atan2(effect.dy, effect.dx);
        const radius = MONK_RULES.combo.range[effect.index ?? 0] * (.8 + .2 * age / life);
        c.globalCompositeOperation = 'screen';
        this.drawRing(x, y, radius, .7, effect.index === 2 ? '#ffd7a0' : '#ff876f', (effect.index === 2 ? 3 : 2) * fade, a - .85 + age * 2, a + .8 + age * 2);
        this.drawRing(x, y, radius * .92, .53, '#fff2d4', 1.5 * fade, a - .5 + age * 2, a + .8 + age * 2);
      } else if (type === 'wave') {
        const colors = ['#7cffe1', '#d4fff5', '#b3ffe9'];
        const radius = MONK_RULES.wave.radius;
        c.globalCompositeOperation = 'screen';
        this.drawRing(x, y, Math.min(radius, .2 + age * radius / .22), .1, colors[0], 4 * fade);
        this.drawRing(x, y, Math.min(radius * .92, .2 + age * radius / .3), .1, colors[1], 1.5 * fade);
        for (let i = 0; i < 18; i++) {
          const a = i / 18 * TAU, r = Math.min(radius, age * radius / .35);
          const s = this.project(x + Math.cos(a) * r, y + Math.sin(a) * r, .1);
          c.fillStyle = colors[2]; c.fillRect(s.x, s.y, 2, 2);
        }
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
    if (this.presentation.player.flash > 0 && !this.reducedMotion) {
      c.fillStyle = `rgba(160,20,48,${this.presentation.player.flash * .32})`; c.fillRect(0, 0, this.width, this.height);
    }
    if (!game.world && game.kills === game.enemies.length) {
      const s = this.project(legacyWorld.exit.x, legacyWorld.exit.y, 3.9);
      c.textAlign = 'center'; c.font = '10px Arial'; c.fillStyle = '#b3f2e3'; c.fillText('К ВОРОТАМ МОНАСТЫРЯ', s.x, s.y);
    }
  }

  drawMap(game) {
    const c = this.map, world = game.world || legacyWorld;
    const width = c.canvas?.width || 360, height = c.canvas?.height || 280;
    // The map centres on the drawn monk, so it scrolls as evenly as the scene.
    const hero = drawnAt(this, game.player);
    const view = hero === game.player ? game : { ...game, player: { ...game.player, x: hero.x, y: hero.y } };
    const { project, scale, markers, tiles, visible, title } = adventureMapLayout(view, width, height);
    c.clearRect(0, 0, width, height);
    c.textAlign = 'center'; c.font = '11px monospace'; c.fillStyle = '#c6baaa';
    c.fillText(title || 'Двор монастыря', width / 2, 18);
    for (const tile of tiles) {
      const p = project(tile.x, tile.y);
      c.beginPath(); c.moveTo(p.x, p.y - scale / 2); c.lineTo(p.x + scale, p.y);
      c.lineTo(p.x, p.y + scale / 2); c.lineTo(p.x - scale, p.y); c.closePath();
      const zoneId = world.zones ? getOverworldZone(tile.x, tile.y).id : world.id;
      c.fillStyle = zoneId === 'camp' ? '#bba07435' : zoneId === 'road' ? '#7bada535' : '#a590b435';
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
        c.fillStyle = '#d2ae74'; c.fillRect(p.x - 3, p.y - 2, 6, 4);
      } else {
        c.strokeStyle = '#eec688'; c.beginPath(); c.arc(p.x, p.y, 3.5, 0, TAU); c.stroke();
      }
    }
    c.globalAlpha = 1;
    const p = project(hero.x, hero.y);
    c.shadowColor = '#b4f3d9'; c.shadowBlur = 7; c.fillStyle = '#dcf7dd';
    c.beginPath(); c.arc(p.x, p.y, 4, 0, TAU); c.fill(); c.shadowBlur = 0;
    if (game.adventure) {
      const names = [['camp', 'ЛАГЕРЬ'], ['road', 'ДОРОГА'], ['courtyard', 'МОНАСТЫРЬ']];
      c.font = '9px monospace';
      names.forEach(([id, name], index) => {
        c.fillStyle = id === (game.locationId || world.id) ? '#ede3c9' : game.adventure.visited?.includes(id) ? '#9da79e' : '#615868';
        c.fillText(name, width * (index + .5) / 3, height - 10);
      });
    }
  }
}
