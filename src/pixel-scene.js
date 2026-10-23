import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { TILES, PILLARS, BRAZIERS, SHRINE, EXIT } from './world.js';
import { decodeHitMask } from './pixel-picking.js';
import { PIXELS_PER_UNIT, pixelAtlases, pixelAssetUrls } from './pixel-assets.js';
import { buildLandscape } from './landscape.js';
import { buildCountryDetails } from './country-details.js';

export { PIXELS_PER_UNIT, pixelAtlases, pixelAssetUrls };
const maskPackages = [
  { url: new URL('../assets/game/pixel-v10/monk-side/hit-masks.json', import.meta.url).href, names: ['monk'] },
  { url: new URL('../assets/game/pixel-v2/hound-world/hit-masks.json', import.meta.url).href, names: ['hound', 'world', 'effects'] },
  { url: new URL('../assets/game/pixel-v1/hit-masks.json', import.meta.url).href, names: ['environment'] },
  { url: new URL('../assets/game/pixel-v3/wraith/hit-masks.json', import.meta.url).href, names: ['wraith'] },
  { url: new URL('../assets/game/pixel-v7/beetle/hit-masks.json', import.meta.url).href, names: ['beetle'] },
  { url: new URL('../assets/game/pixel-v4/landscape/hit-masks.json', import.meta.url).href, names: ['landscape'] },
  { url: new URL('../assets/game/pixel-v5/camp/hit-masks.json', import.meta.url).href, names: ['camp', 'campFlame'] },
  { url: new URL('../assets/game/pixel-v6/country/hit-masks.json', import.meta.url).href, names: ['countryDetails'] },
  { url: new URL('../assets/game/pixel-v9/camp-panorama/hit-masks.json', import.meta.url).href, names: ['campPanorama'] },
];

function flatMaterial(scene, name, hex) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.FromHexString(hex);
  material.emissiveColor = Color3.FromHexString(hex);
  material.specularColor = Color3.Black();
  return material;
}

export function loadPixelAssets(scene) {
  const assets = {}, pending = [];
  for (const [name, url] of Object.entries(pixelAssetUrls)) {
    const atlas = pixelAtlases[name];
    const surface = Array.isArray(atlas?.size);
    if (!surface && (!Number.isInteger(atlas?.cell) || atlas.cell <= 0)) throw new Error(`Invalid scalar cell for ${name}`);
    let resolve, reject;
    pending.push(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const texture = new Texture(url, scene, true, true, Texture.NEAREST_SAMPLINGMODE,
      resolve, message => reject(new Error(`Не загружен ${name}: ${message || url}`)));
    texture.wrapU = texture.wrapV = surface ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
    texture.hasAlpha = !surface;
    assets[name] = { ...atlas, texture };
  }
  for (const { url, names } of maskPackages) pending.push(fetch(url).then(async response => {
    if (!response.ok) throw new Error(`Не загружены hit masks: ${url}`);
    const packed = await response.json();
    for (const name of names) {
      const atlas = assets[name], source = packed[atlas.path];
      if (!source) throw new Error(`Нет hit mask для ${atlas.path}`);
      const mask = decodeHitMask(source);
      // Early packages encoded height only through the bit count. If a newer
      // package declares it explicitly, validate it as well.
      if (mask.width !== atlas.columns * atlas.cell || (source.height !== undefined && source.height !== atlas.rows * atlas.cell) ||
        mask.bytes.length * 8 < mask.width * atlas.rows * atlas.cell) {
        throw new Error(`Неверный размер hit mask для ${atlas.path}`);
      }
      atlas.mask = mask;
    }
  }));
  // Appearance textures have their own recoverable loading state. Waiting for
  // the entire scene here would also wait for those unrelated requests.
  assets.ready = Promise.all(pending);
  return assets;
}

export function createSprite(scene, name, atlas, frame = 0) {
  const size = atlas.cell / PIXELS_PER_UNIT;
  const mesh = MeshBuilder.CreatePlane(name, { width: size, height: size }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, (atlas.anchor[1] - atlas.cell / 2) / PIXELS_PER_UNIT, 0));
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.renderingGroupId = 1;
  const material = flatMaterial(scene, `${name}-ink`, '#ffffff');
  const texture = atlas.texture.clone();
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = Material.MATERIAL_ALPHATEST;
  material.alphaCutOff = .5;
  material.backFaceCulling = false;
  mesh.material = material;
  const sprite = { mesh, material, texture, atlas, frame: -1, flip: null };
  setSpriteFrame(sprite, { frame, flip: false });
  return sprite;
}

export function setSpriteFrame(sprite, { frame, flip }) {
  if (sprite.frame === frame && sprite.flip === flip) return;
  const { columns, rows } = sprite.atlas;
  sprite.texture.uScale = (flip ? -1 : 1) / columns;
  sprite.texture.vScale = 1 / rows;
  sprite.texture.uOffset = (frame % columns + (flip ? 1 : 0)) / columns;
  sprite.texture.vOffset = 1 - (Math.floor(frame / columns) + 1) / rows;
  sprite.frame = frame; sprite.flip = flip;
}

export function disposeSprite(sprite) {
  if (!sprite) return;
  sprite.mesh.dispose();
  sprite.material.dispose();
  sprite.texture.dispose();
}

export function loadAppearanceTexture(scene, url) {
  return new Promise((resolve, reject) => {
    // SpriteAppearance deduplicates selections. Each accepted load/retry owns
    // its transport instead of joining an older in-flight Babylon cache entry.
    const internalTexture = scene.getEngine().createTexture(url, true, true, scene, Texture.NEAREST_SAMPLINGMODE);
    const texture = new Texture(url, scene, {
      internalTexture, noMipmap: true, invertY: true, samplingMode: Texture.NEAREST_SAMPLINGMODE,
      onLoad: () => resolve(texture),
      onError: message => { texture.dispose(); reject(new Error(`Не загружен облик: ${message || url}`)); },
    });
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.hasAlpha = true;
  });
}

// Textures are independent of the shared atlas, whose clip order and alpha
// masks are identical for every appearance. A superseded load never applies.
export class SpriteAppearance {
  constructor(sprite, load) {
    this.sprite = sprite; this.load = load; this.revision = 0;
    this.status = 'loading';
  }

  getStatus(url) {
    if (this.disposed || url !== this.requested) return { status: 'loading' };
    return this.status === 'error' ? { status: 'error', error: this.error } : { status: this.status };
  }

  select(url, { retry = false } = {}) {
    if (this.disposed) return Promise.resolve(false);
    // Cache failures too: render frames must not turn an outage into a request
    // loop. An explicit retry starts a fresh revision, even for the same URL.
    if (!retry && url === this.requested) return this.pending;
    this.requested = url;
    const revision = ++this.revision;
    this.error = undefined;
    if (!retry && url === this.current) {
      this.status = 'ready';
      return (this.pending = Promise.resolve(true));
    }
    this.status = 'loading';
    this.pending = this.load(url).then(texture => {
      if (this.disposed || revision !== this.revision) { texture.dispose(); return false; }
      const sprite = this.sprite, previous = sprite.texture;
      const pose = { frame: sprite.frame, flip: sprite.flip };
      sprite.texture = texture;
      sprite.material.diffuseTexture = texture;
      sprite.frame = -1;
      setSpriteFrame(sprite, pose);
      previous.dispose();
      this.current = url;
      this.status = 'ready';
      return true;
    }).catch(error => {
      if (this.disposed || revision !== this.revision) return false;
      this.status = 'error';
      this.error = error instanceof Error ? error : new Error(String(error));
      throw this.error;
    });
    return this.pending;
  }

  dispose() { this.disposed = true; this.revision++; }
}

// Flat ground art (carpet, tufts) lies on the floor like a contact shadow:
// the same screen drawing, but with ground depth, so shadows and interaction
// rings stay visible on top of it and actors are never drawn under it.
const GROUND_BASIS = Matrix.FromValues(
  -Math.SQRT1_2, 0, Math.SQRT1_2, 0,
  -Math.SQRT2, 0, -Math.SQRT2, 0,
  0, 1, 0, 0,
  0, 0, 0, 1);
export function layOnGround(sprite) {
  sprite.mesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
  sprite.mesh.bakeTransformIntoVertices(GROUND_BASIS);
  sprite.mesh.renderingGroupId = 0;
  sprite.mesh.position.y = .012;
}

export function setGroundEffectDirection(sprite, dx, dy) {
  // Warning artwork already contains the fixed camera's 2:1 ground foreshortening.
  // Undo that in the ground plane before yawing its +X chevron along the attack.
  // The camera projects it back to an ellipse; rotating a billboard would tilt it.
  sprite.mesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
  sprite.mesh.scaling.y = 2;
  sprite.mesh.rotation.set(Math.PI / 2, -Math.atan2(dy, dx), 0);
}

// Contact shadows are drawn at the 32 px/u asset density: a 2:1 stepped ellipse
// with a darker core and two hard alpha levels. Width is even, so the ellipse
// has a centre column pair and mirrors exactly with an actor's drawing.
const SHADOW_CORE = .36, SHADOW_RIM = 160;
export function shadowPixels(radius) {
  const width = 2 * Math.max(2, Math.round(radius * PIXELS_PER_UNIT)), height = width / 2;
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i + .5 - width / 2) / (width / 2), y = (j + .5 - height / 2) / (height / 2), d = x * x + y * y;
    data.set([255, 255, 255, d <= SHADOW_CORE ? 255 : d <= 1 ? SHADOW_RIM : 0], (j * width + i) * 4);
  }
  return { width, height, data };
}

// Shadows of one size share a texture. The last shadow of a size releases it, so
// enemies, shots and location changes leave the scene's texture count unchanged.
const shadowTextures = new WeakMap();
function shadowTexture(scene, radius) {
  if (!shadowTextures.has(scene)) shadowTextures.set(scene, new Map());
  const cache = shadowTextures.get(scene), { width, height, data } = shadowPixels(radius);
  let entry = cache.get(width);
  if (!entry) {
    const texture = RawTexture.CreateRGBATexture(data, width, height, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    texture.name = `contact-shadow-${width}x${height}`;
    texture.hasAlpha = true;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    cache.set(width, entry = { texture, width, height, users: 0 });
  }
  entry.users++;
  return entry;
}

// The quad lies on the floor like a ground warning: its texture X follows screen
// right and its Y is doubled to undo the camera's 2:1 foreshortening, so shadow
// texels stay aligned with the screen pixel grid. Scale it uniformly only.
export function createShadow(scene, name, radius = .55, { alpha = .46 } = {}) {
  const entry = shadowTexture(scene, radius);
  const mesh = MeshBuilder.CreatePlane(name, { width: entry.width / PIXELS_PER_UNIT, height: entry.height / PIXELS_PER_UNIT }, scene);
  mesh.bakeTransformIntoVertices(Matrix.FromValues(
    -Math.SQRT1_2, 0, Math.SQRT1_2, 0,
    -Math.SQRT2, 0, -Math.SQRT2, 0,
    0, 1, 0, 0,
    0, 0, 0, 1));
  const material = flatMaterial(scene, `${name}-material`, '#141223');
  material.diffuseTexture = entry.texture;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.alpha = alpha;
  mesh.material = material;
  mesh.position.y = .02;
  mesh.isPickable = false;
  mesh.onDisposeObservable.addOnce(() => {
    if (--entry.users > 0) return;
    entry.texture.dispose();
    if (shadowTextures.get(scene)?.get(entry.width) === entry) shadowTextures.get(scene).delete(entry.width);
  });
  return mesh;
}

export const legacyWorld = {
  id: 'legacy', tiles: TILES, pillars: PILLARS, braziers: BRAZIERS,
  shrine: SHRINE, exit: EXIT, portals: [], secret: null, ritual: null, reward: null,
};

export function buildPixelWorld(scene, assets, data = legacyWorld) {
  const resourceKinds = ['meshes', 'multiMaterials', 'materials', 'textures'];
  const before = Object.fromEntries(resourceKinds.map(key => [key, new Set(scene[key])]));
  const landscape = data.id === 'legacy' ? null : buildLandscape(scene, assets, data);
  const zones = (data.zones ?? [data]).map((zone, index) => buildPixelZone(scene, assets, zone, landscape, index === 0));
  const built = zones[0];
  if (data.zones) {
    for (const key of ['columns', 'fires', 'props', 'portals']) built[key] = zones.flatMap(zone => zone[key]);
    for (const key of ['gate', 'shrine', 'secret', 'reward', 'ritual']) built[key] = zones.find(zone => zone[key])?.[key] ?? null;
    built.bounds = landscape.bounds;
  }
  const owned = Object.fromEntries(resourceKinds.map(key => [key, scene[key].filter(item => !before[key].has(item))]));
  let disposed = false;
  return { ...built, data,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const kind of resourceKinds) for (const resource of owned[kind]) resource.dispose();
    },
  };
}

// Every zone contributes only its authored props. All zones share the union's
// ground, natural exterior and detail batch, owned by buildPixelWorld above.
function buildPixelZone(scene, assets, data, landscape, includeLandscape) {
  const camp = data.id === 'camp', road = data.id === 'road';
  const palette = camp ? { stone: '#d6c3ac', trim: '#937850', edge: '#463c42', ink: '#dfb477' }
    : road ? { stone: '#aebbb9', trim: '#506b65', edge: '#303b40', ink: '#80b9ac' }
      : { stone: '#d0c5d2', trim: '#62526b', edge: '#3a304a', ink: '#ba83b7' };
  const top = flatMaterial(scene, 'paving-top', data.id === 'legacy' ? '#ffffff' : palette.stone);
  top.diffuseTexture = assets.floor.texture;
  const sides = [palette.edge, '#423a50', '#302b3f'].map((hex, i) => flatMaterial(scene, `stone-side-${i}`, hex));
  const trim = flatMaterial(scene, 'weathered-inlay', palette.trim);
  const groups = [[], [], [], [], []];
  const cells = new Set(data.tiles.map(p => `${p.x},${p.y}`));
  const has = (x, y) => cells.has(`${x},${y}`);
  const edges = [];
  for (const { x, y } of landscape ? [] : data.tiles) {
    const tile = MeshBuilder.CreateGround('stone-tile', { width: 1, height: 1 }, scene);
    tile.position.set(x, 0, y);
    tile.rotation.y = ((x * 7 + y * 13) % 4) * Math.PI / 2;
    tile.material = top; tile.isPickable = false;
    groups[0].push(tile);
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !has(x + dx, y + dy))) {
      edges.push({ x, y });
      const index = Math.abs(x * 7 + y * 3) % 3;
      const edge = MeshBuilder.CreateBox('cut-stone-edge', { width: 1, depth: 1, height: .48 }, scene);
      edge.position.set(x, -.25, y); edge.material = sides[index]; edge.isPickable = false;
      groups[index + 1].push(edge);
      if (data.id !== 'legacy') {
        const weather = MeshBuilder.CreateGround('edge-inlay', { width: .72, height: .72 }, scene);
        weather.position.set(x, .008, y); weather.material = trim; weather.isPickable = false;
        groups[4].push(weather);
      }
    }
  }
  const merged = landscape ? [landscape.floor] : groups.map(group => {
    if (!group.length) return null;
    const mesh = Mesh.MergeMeshes(group, true, true);
    mesh.isPickable = false; mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix();
    return mesh;
  });

  const props = [];
  const propHeight = .03;
  const place = (name, frame, x, y, atlas = assets.environment) => {
    const sprite = createSprite(scene, name, atlas, frame);
    sprite.mesh.position.set(x, propHeight, y);
    props.push(sprite);
    return sprite;
  };
  const placeLandscape = (name, frame, x, y, height, atlas = assets.landscape) => {
    const sprite = place(name, frame, x, y, atlas);
    sprite.mesh.position.y = height + propHeight;
    // Natural borders and backdrop stay behind actors and combat tells.
    sprite.mesh.renderingGroupId = 0;
    return sprite;
  };
  if (landscape && includeLandscape) {
    for (const [i, p] of [...landscape.scenery, ...landscape.border].entries()) {
      const sprite = placeLandscape(`landscape-${p.frame}-${i}`, assets.landscape.frames.indexOf(p.frame), p.x, p.y, p.height);
      setSpriteFrame(sprite, { frame: sprite.frame, flip: p.flip });
      sprite.mesh.scaling.setAll(p.scale ?? 1);
      if (p.border) sprite.borderPlacement = p;
    }
    landscape.details = buildCountryDetails(scene, assets.countryDetails, landscape.groundCover);
  }
  const campProps = camp ? data.setDressing.map(p => {
    const atlas = [assets.camp, assets.campPanorama, assets.landscape].find(a => a?.frames.includes(p.kind));
    if (!atlas) throw new Error(`Unknown camp prop: ${p.kind}`);
    const frame = atlas.frames.indexOf(p.kind);
    const sprite = place(`camp-${p.id}`, frame, p.x, p.y, atlas);
    sprite.placement = p;
    sprite.mesh.scaling.setAll(p.scale);
    setSpriteFrame(sprite, { frame, flip: p.flip });
    const ground = landscape.cells.get(`${Math.round(p.x)},${Math.round(p.y)}`);
    sprite.mesh.position.y = (ground?.height ?? 0) + propHeight;
    if (p.kind === 'grass') sprite.mesh.renderingGroupId = 0;
    if (p.layer === 'ground') layOnGround(sprite);
    return sprite;
  }) : [];
  // Measured contact diamond at (80,132), stable across all location columns.
  const columnOffset = Math.SQRT2 * ((assets.environment.anchor[1] - 132) / PIXELS_PER_UNIT + propHeight * Math.sin(Math.PI / 3));
  const columns = camp ? campProps.filter(sprite => ['road-marker', 'ruin-pillar'].includes(sprite.placement.kind))
    : data.pillars.map((p, i) => place(`column-${i}`, 2, p.x + columnOffset, p.y + columnOffset));
  const minX = Math.min(...data.tiles.map(p => p.x)), maxX = Math.max(...data.tiles.map(p => p.x));
  const minY = Math.min(...data.tiles.map(p => p.y)), maxY = Math.max(...data.tiles.map(p => p.y));
  if (data.id === 'legacy') place('rear-ruin', 0, -5.25, -5.25);
  else if (!camp) {
    // Isolated old ruins retain their anchors on the continuous outdoor ground.
    const ruin = (name, frame, x, y) => placeLandscape(name, frame, x, y,
      landscape.cells.get(`${Math.round(x)},${Math.round(y)}`).height, assets.environment);
    if (road) ruin('road-fallen-arch', 1, minX - 3, data.shrine?.y ?? (minY + maxY) / 2);
    else {
      ruin('monastery-west-ruin', 0, minX - 3, minY - 2);
      ruin('monastery-east-ruin', 1, maxX + 3, minY - 2);
    }
  }
  const gateAtlas = data.id === 'legacy' ? assets.world : assets.environment;
  const gate = !road && !camp && data.exit
    ? place('monastery-gate', data.id === 'legacy' ? gateAtlas.clips.gate.front[0] : gateAtlas.frames.indexOf('arch'),
      data.exit.x, data.exit.y - .5, gateAtlas) : null;
  const shrine = data.shrine
    ? place('healing-shrine', assets.world.clips.shrine.front[0], data.shrine.x - .5, data.shrine.y - .5, assets.world) : null;

  const material = (name, color) => flatMaterial(scene, name, color);
  const box = (name, x, y, h, width, depth, height, ink) => {
    const mesh = MeshBuilder.CreateBox(name, { width, depth, height }, scene);
    mesh.position.set(x, h, y); mesh.material = ink; mesh.isPickable = false;
    return mesh;
  };
  const ring = (name, x, y, radius, ink, height = .045) => {
    const mesh = MeshBuilder.CreateTorus(name, { diameter: radius * 2, thickness: .035, tessellation: 32 }, scene);
    mesh.position.set(x, height, y); mesh.material = ink; mesh.isPickable = false;
    return mesh;
  };
  const markerInk = material('waypoint-ink', palette.ink);
  const portals = data.portals.map(p => ({ ...p, ring: ring(`portal-${p.id}`, p.x, p.y, .62, markerInk) }));
  for (const p of portals) {
    // Small paired threshold stones mark an interaction, leaving the middle open.
    for (const side of [-1, 1]) box('portal-threshold', p.x + side * .84, p.y, .08, .16, .65, .16, trim);
  }
  const fires = camp ? campProps.filter(sprite => sprite.placement.kind === 'campfire-base').map(base => {
    const p = base.placement, sprite = place(`camp-${p.id}-flame`, 0, p.x, p.y, assets.campFlame);
    sprite.mesh.position.copyFrom(base.mesh.position);
    sprite.mesh.scaling.copyFrom(base.mesh.scaling);
    setSpriteFrame(sprite, { frame: 0, flip: p.flip });
    // Coplanar billboards share their exact ground anchor; a depth bias keeps
    // the flame root on top of the static stones without moving either image.
    sprite.material.zOffset = -1;
    return { x: p.x, y: p.y, color: 'amber', base, sprite };
  }) : data.braziers.map((b, i) => {
    if (b.color !== 'amber') {
      const clip = b.color === 'cyan' ? 'brazier-cyan' : 'brazier-magenta';
      return { ...b, clip, sprite: place(`brazier-${i}`, assets.world.clips[clip].front[0], b.x, b.y, assets.world) };
    }
    const stone = material('camp-fire-stone', '#6a5754');
    box('camp-brazier-foot', b.x, b.y, .09, .48, .48, .18, stone);
    box('camp-brazier-stem', b.x, b.y, .3, .23, .23, .42, stone);
    const bowl = MeshBuilder.CreateCylinder('camp-brazier-bowl', { diameterTop: .7, diameterBottom: .3, height: .2, tessellation: 8 }, scene);
    bowl.position.set(b.x, .57, b.y); bowl.material = material('brazier-coal', '#3c303a'); bowl.isPickable = false;
    const flames = ['#d97c47', '#efad60', '#ffe1a0'].map((color, j) => {
      const flame = MeshBuilder.CreateCylinder(`amber-flame-${j}`, { diameterBottom: .43 - j * .1, diameterTop: 0,
        height: .76 - j * .17, tessellation: 5 }, scene);
      flame.position.set(b.x, .84 - j * .06, b.y); flame.material = material(`ember-${j}`, color); flame.isPickable = false;
      return flame;
    });
    return { ...b, flames };
  });

  if (road) {
    const moss = material('road-moss', '#4e6760');
    // Only low chips on exposed edges: the long route and western fork stay open.
    for (let i = 0; i < edges.length; i += 5) {
      const p = edges[i];
      box('road-edge-chip', p.x, p.y, .025, .12 + i % 3 * .04, .28, .045, moss);
    }
  }

  let secret = null, reward = null;
  if (data.secret) {
    const p = data.secret, wood = material('cache-wood', '#71524f'), brass = material('cache-brass', '#c49b6c');
    const chest = box('secret-cache', p.x, p.y, .19, .68, .44, .38, wood);
    const lid = box('cache-lid', p.x, p.y, .41, .73, .49, .09, brass);
    box('cache-lock', p.x, p.y + .24, .24, .12, .035, .13, brass);
    secret = { chest, lid, ring: ring('cache-rune', p.x, p.y, .58, brass) };
  }
  if (data.reward) {
    const p = data.reward, brass = material('reward-amber', '#ffd390');
    if (!camp) box('bead-offering-stone', p.x, p.y, .16, .55, .55, .32, trim);
    const bead = MeshBuilder.CreateSphere('amber-bead', { diameter: .18, segments: 4 }, scene);
    bead.position.set(p.x, .65, p.y); bead.material = brass; bead.isPickable = false;
    reward = { bead, ring: ring('reward-inlay', p.x, p.y, .5, brass) };
  }

  let ritual = null;
  if (data.ritual || data.id === 'legacy') {
    const p = data.ritual || { x: 0, y: 0 };
    // Native pixel seal: shared stone vocabulary, quiet behind moving actors.
    const seal = new DynamicTexture('ritual-seal', 128, scene, false, Texture.NEAREST_SAMPLINGMODE);
    const c = seal.getContext();
    c.clearRect(0, 0, 128, 128); c.strokeStyle = '#a09789'; c.lineWidth = 1;
    for (const radius of [44, 49]) { c.beginPath(); c.arc(64, 64, radius, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(64, 34); c.lineTo(94, 64); c.lineTo(64, 94); c.lineTo(34, 64); c.closePath(); c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      c.fillStyle = '#a09789'; c.fillRect(Math.round(63 + Math.cos(a) * 39), Math.round(63 + Math.sin(a) * 39), 2, 2);
    }
    seal.hasAlpha = true; seal.update();
    const ink = material('seal-ink', '#ffffff');
    ink.diffuseTexture = seal; ink.useAlphaFromDiffuseTexture = true; ink.transparencyMode = Material.MATERIAL_ALPHATEST;
    const sealMesh = MeshBuilder.CreateGround('seal', { width: 4, height: 4 }, scene);
    sealMesh.material = ink; sealMesh.position.set(p.x, .012, p.y); sealMesh.isPickable = false;
    if (data.ritual) {
      const glow = material('ritual-binding', '#ba719c');
      const rings = [1.1, 1.3].map((radius, i) => ring(`ritual-binding-${i}`, p.x, p.y, radius, glow));
      const shards = Array.from({ length: 4 }, (_, i) => {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const shard = box('ritual-seal-post', p.x + Math.cos(a) * 1.2, p.y + Math.sin(a) * 1.2, .27, .13, .13, .54, glow);
        shard.rotation.z = .12; return shard;
      });
      ritual = { seal: sealMesh, ink: glow, rings, shards };
    }
  }

  return { data, columns, gate, shrine, fires, props, portals, secret, reward, ritual, landscape, floor: merged[0],
    bounds: { minX, maxX, minY, maxY },
  };
}
