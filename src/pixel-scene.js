import { flushStaticMaterialDirty } from './static-material-dirty.js';
import { scheduleStaticObservation } from './static-observation.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { captureStaticSpriteState, isCapturedStaticMaterial } from './static-sprite-shape.js';
// HD-2D lights: material hook; dormant until the host enables the effect.
import { registerMaterial as registerHdLightMaterial } from './hd2d/lights.js';
import { StaticSpriteBatch } from './static-batch.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { TILES, PILLARS, BRAZIERS, SHRINE, EXIT } from './world.js';
import { decodeHitMask } from './pixel-picking.js';
import { takePreloadedTexture, takePreloadedResponse } from './preloaded-assets.js';
import {
  PIXELS_PER_UNIT, pixelAtlases, pixelAssetUrls, LOOT_GROUND, lootAtlases, lootAssetUrls, monkWeaponsManifestUrl, monkWeaponUrls,
} from './pixel-assets.js';
import { buildLandscape } from './landscape.js';
import { roadPillar } from './road-country.js';
import { buildCountryDetails } from './country-details.js';
import { RARITIES } from './items.js';
import { CAMP_SUPPLIES } from './campaign.js';
import { CacheGlow, CACHE_FRAMES } from './cache-glow.js';
import { campNpcPlacements, campNpcFrame, writeCampNpcUvs } from './camp-npcs.js';
import { lightAt, tintEmissive } from './scene-light.js';

export { PIXELS_PER_UNIT, pixelAtlases, pixelAssetUrls, LOOT_GROUND, lootAtlases, lootAssetUrls, monkWeaponsManifestUrl, monkWeaponUrls };
// The renderer takes its level-up light from here, with the rest of its pixel art.
export { LevelUpLight } from './level-up-fx.js';
// The renderer's optional picture layers, beside its other world helpers.
export { ScenePolish } from './scene-polish.js';
const maskPackages = [
  { url: new URL('../assets/game/pixel-v15/cache/hit-masks.json', import.meta.url).href, names: ['cache'] },
  { url: new URL('../assets/game/pixel-v17/monk-side/hit-masks.json', import.meta.url).href, names: ['monk'] },
  { url: new URL('../assets/game/pixel-v2/hound-world/hit-masks.json', import.meta.url).href, names: ['hound', 'world', 'effects'] },
  { url: new URL('../assets/game/pixel-v1/hit-masks.json', import.meta.url).href, names: ['environment'] },
  { url: new URL('../assets/game/pixel-v3/wraith/hit-masks.json', import.meta.url).href, names: ['wraith'] },
  { url: new URL('../assets/game/pixel-v7/beetle/hit-masks.json', import.meta.url).href, names: ['beetle'] },
  { url: new URL('../assets/game/pixel-v4/landscape/hit-masks.json', import.meta.url).href, names: ['landscape'] },
  { url: new URL('../assets/game/pixel-v5/camp/hit-masks.json', import.meta.url).href, names: ['camp', 'campFlame'] },
  { url: new URL('../assets/game/pixel-v6/country/hit-masks.json', import.meta.url).href, names: ['countryDetails'] },
  { url: new URL('../assets/game/pixel-v9/camp-panorama/hit-masks.json', import.meta.url).href, names: ['campPanorama'] },
  { url: new URL('../assets/game/pixel-v11/monastery-ruins/hit-masks.json', import.meta.url).href, names: ['monasteryRuins', 'monasteryWorld'] },
  { url: new URL('../assets/game/pixel-v13/cemetery/hit-masks.json', import.meta.url).href, names: ['cemetery'] },
  { url: new URL('../assets/game/pixel-v13/orchard/hit-masks.json', import.meta.url).href, names: ['orchard'] },
];

// The hit-mask JSON files loadPixelAssets fetches, for a preloader that warms the browser cache.
export const hitMaskUrls = Object.freeze(maskPackages.map(({ url }) => url));
const powerOfTwo = n => n > 0 && (n & (n - 1)) === 0;

// The caches and shrines of a world or a zone, by id (world-expansion §6.2). A world without the
// arrays has the road's one cache ('secret') and one shrine ('road-shrine').
export const cachesOf = world => world.caches ?? (world.secret ? [{ id: 'secret', ...world.secret }] : []);
export const shrinesOf = world => world.shrines ?? (world.shrine ? [{ id: 'road-shrine', ...world.shrine }] : []);
// The atlases an authored zone's props come from, searched in order. A side zone takes its own
// pixel-v13 atlas first (world-expansion §4.1).
const PROP_ATLASES = {
  cemetery: ['cemetery', 'monasteryRuins', 'campPanorama'],
  orchard: ['orchard', 'monasteryRuins', 'campPanorama'],
};

function flatMaterial(scene, name, hex, configure = null) {
  const material = new StandardMaterial(name, scene);
  // Runtime impacts and shots otherwise scan every scene submesh for each
  // setter. Block only the new material, never dirty every scenery material.
  const block = configure && !scene.blockMaterialDirtyMechanism;
  if (block) material.blockDirtyMechanism = true;
  try {
    material.disableLighting = true;
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex);
    material.specularColor = Color3.Black();
    configure?.(material);
  } finally {
    // No mesh has used this brand-new material yet. The public unblock setter
    // calls markDirty(), which scans every scene mesh even when none can use it.
    if (block) material._blockDirtyMechanism = false;
  }
  // HD-2D lights: keep impact, shadow and purely emissive effects unlit.
  if (!/shadow|shot|warning|effect|fx-|motes|pool|flame|binding/.test(name)) registerHdLightMaterial(material);
  return material;
}

// Each material change marks every submesh in the scene that may use that material: over a build of
// hundreds of sprites that is quadratic. A build blocks the marking; the unblock marks every material
// once (Babylon's own full update). A nested build keeps the outer block.
export function batchMaterials(scene, build) {
  if (scene.blockMaterialDirtyMechanism) return build();
  scene.blockMaterialDirtyMechanism = true;
  try { return build(); } finally { flushStaticMaterialDirty(scene, scene.materials?.filter(isCapturedStaticMaterial) ?? [], () => { scene.blockMaterialDirtyMechanism = false; }); }
}

// Blob URLs reuse the splash's PNG bytes without another HTTP request. Creating the
// internal texture from its URL keeps GPU uploads asynchronous: a decoded `buffer` would upload every
// atlas inside the synchronous world build. The wrapper preserves the original public texture URL.
function atlasTexture(scene, url, onLoad, onError, independent = false) {
  const preloaded = takePreloadedTexture(url);
  if (!preloaded && !independent) return new Texture(url, scene, true, true, Texture.NEAREST_SAMPLINGMODE, onLoad, onError);
  const internalTexture = scene.getEngine().createTexture(preloaded?.url ?? url, true, true, scene, Texture.NEAREST_SAMPLINGMODE);
  return new Texture(url, scene, {
    internalTexture, noMipmap: true, invertY: true, samplingMode: Texture.NEAREST_SAMPLINGMODE,
    onLoad: () => { preloaded?.release(); onLoad?.(); },
    onError: message => { preloaded?.release(); onError?.(message); },
  });
}

// onProgress(loaded, total, label) follows the loading for a preloader: once with (0, total, null)
// before any file arrives, then after each of the `total` items settles, loaded or failed, with its
// label (an atlas name, 'masks:monk' style for a hit-mask package, or 'monkWeapons'). `ready`
// still decides failure; a failed item counts as settled.
export function loadPixelAssets(scene, { onProgress = null } = {}) {
  const assets = {}, pending = [], labels = [];
  const track = (label, promise) => { labels.push(label); pending.push(promise); };
  for (const [name, url] of Object.entries(pixelAssetUrls)) {
    const atlas = pixelAtlases[name];
    const surface = Array.isArray(atlas?.size);
    if (!surface && (!Number.isInteger(atlas?.cell) || atlas.cell <= 0)) throw new Error(`Invalid scalar cell for ${name}`);
    let resolve, reject;
    track(name, new Promise((yes, no) => { resolve = yes; reject = no; }));
    const texture = atlasTexture(scene, url, resolve, message => reject(new Error(`Не загружен ${name}: ${message || url}`)));
    // WebGL1 cannot repeat a non-power-of-two texture (it samples black), so there such a surface
    // clamps; only the 2048×1280 mountain backdrop is one. WebGL2 repeats every surface.
    const repeat = surface && (scene.getEngine().webGLVersion > 1 || (powerOfTwo(atlas.size[0]) && powerOfTwo(atlas.size[1])));
    texture.wrapU = texture.wrapV = repeat ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
    texture.hasAlpha = !surface;
    assets[name] = { ...atlas, texture };
  }
  for (const { url, names } of maskPackages) track(`masks:${names.join('+')}`, Promise.resolve(takePreloadedResponse(url) ?? fetch(url)).then(async response => {
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
  // Ground loot is optional: a failed atlas is marked and the renderer draws procedural loot
  // instead. Its load still settles before the world is ready, so nothing pops in later.
  for (const [name, url] of Object.entries(lootAssetUrls)) {
    const atlas = assets[name] = { ...lootAtlases[name], failed: false };
    track(name, new Promise(settle => {
      atlas.texture = atlasTexture(scene, url, settle, () => { atlas.failed = true; settle(); });
    }));
    atlas.texture.wrapU = atlas.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    atlas.texture.hasAlpha = true;
  }
  // The monk's weapon layers are optional as well. `manifest` is set once the manifest and all three
  // textures have loaded; until then, or after a failure, armed poses keep the bare-hand drawings.
  const weapons = assets.monkWeapons = { failed: false, manifest: null };
  track('monkWeapons', Promise.resolve(takePreloadedResponse(monkWeaponsManifestUrl) ?? fetch(monkWeaponsManifestUrl)).then(response => {
    if (!response.ok) throw new Error(`Не загружено оружие монаха: ${monkWeaponsManifestUrl}`);
    return response.json();
  }).then(manifest => Promise.all(Object.entries(monkWeaponUrls).map(([name, url]) => new Promise((loaded, failed) => {
    weapons[name] = monkWeaponAtlas(manifest[name]);
    weapons[name].texture = atlasTexture(scene, url, loaded, message => failed(new Error(`Не загружено оружие монаха: ${message || url}`)));
    weapons[name].texture.wrapU = weapons[name].texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    weapons[name].texture.hasAlpha = true;
  }))).then(() => { weapons.manifest = manifest; })).catch(() => { weapons.failed = true; }));
  if (onProgress) {
    let loaded = 0;
    onProgress(0, pending.length, null);
    pending.forEach((promise, i) => promise.then(() => {}, () => {}).then(() => onProgress(++loaded, pending.length, labels[i])));
  }
  // Appearance textures have their own recoverable loading state. Waiting for
  // the entire scene here would also wait for those unrelated requests.
  assets.ready = Promise.all(pending);
  return assets;
}

// A weapon layer atlas for createSprite: the swing cells are 160 × 144, the others square.
export function monkWeaponAtlas({ cell, ...layer }) {
  return Array.isArray(cell) ? { ...layer, frameSize: cell } : { ...layer, cell };
}

// The sprites of one atlas share one anchored plane: its geometry and GPU buffers, built with the first
// of them. A world builds hundreds of sprites. A sprite whose vertices change takes its own copy
// first (layOnGround); the plane goes away with its last sprite and the next one builds it again.
const spritePlanes = new WeakMap();
function spritePlane(scene, name, atlas) {
  const shared = spritePlanes.get(atlas);
  if (shared && !shared.isDisposed() && shared.getScene() === scene) {
    const mesh = new Mesh(name, scene);
    shared.applyToMesh(mesh);
    return mesh;
  }
  // Square atlases anchor on their centre column; a frameSize atlas (pixel-v12) also gives its anchor column.
  const [width, height] = atlas.frameSize ?? [atlas.cell, atlas.cell], anchorX = atlas.frameSize ? atlas.anchor[0] : width / 2;
  const mesh = MeshBuilder.CreatePlane(name, { width: width / PIXELS_PER_UNIT, height: height / PIXELS_PER_UNIT }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation((width / 2 - anchorX) / PIXELS_PER_UNIT,
    (atlas.anchor[1] - height / 2) / PIXELS_PER_UNIT, 0));
  spritePlanes.set(atlas, mesh.geometry);
  return mesh;
}

export function createSprite(scene, name, atlas, frame = 0, ink = null) {
  const mesh = spritePlane(scene, name, atlas);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.renderingGroupId = 1;
  const texture = atlas.texture.clone();
  // No identity-matrix shortcut: with it, the first drawn frame scans every material for this texture.
  // The frame's texture matrix always applies, which gives the same UVs for an identity matrix too.
  texture.optimizeUVAllocation = false;
  const material = flatMaterial(scene, `${name}-ink`, '#ffffff', material => {
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = ink?.transparencyMode ?? Material.MATERIAL_ALPHATEST;
    if (ink?.alpha !== undefined) material.alpha = ink.alpha;
    material.alphaCutOff = .5;
    material.backFaceCulling = false;
  });
  // HD-2D lights: map cloned atlas textures back to optional normal maps.
  if (!/shadow|shot|warning|effect|fx-|motes|pool|flame|binding/.test(name)) registerHdLightMaterial(material, atlas);
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
    const texture = atlasTexture(scene, url, () => resolve(texture),
      message => { texture.dispose(); reject(new Error(`Не загружен облик: ${message || url}`)); }, true);
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
      // HD-2D lights: appearance atlases retain the same normal/height layout.
      registerHdLightMaterial(sprite.material, sprite.atlas);
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
  // The plane is shared with the atlas's other sprites (spritePlane).
  sprite.mesh.makeGeometryUnique();
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
    // This new texture has no material users, so there is nothing to invalidate.
    texture._hasAlpha = true;
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
  const material = flatMaterial(scene, `${name}-material`, '#141223', material => {
    material.diffuseTexture = entry.texture;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.alpha = alpha;
  });
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

// Placeholder procedural art (§2.3, §5.4) until the authored icons land. Pixel maps are
// rows from the top; '.' is clear. Every drawn shape gets a one-pixel ink outline.
const INK = '#211a28';
// styles.css values of the RARITIES colour tokens.
const TOKEN_HEX = { '--ivory': '#eee0ce', '--spirit': '#6dd6cb', '--amber': '#e5b66e' };
export const rarityInk = rarity => TOKEN_HEX[RARITIES[rarity]?.color] ?? TOKEN_HEX['--ivory'];
const BRONZE = { a: '#f0c987', b: '#c8935a', c: '#8f5f3e' }, WOOD = { a: '#a8764e', b: '#d2c3a6', c: '#5e3b2c' };
const SPIRIT = { l: '#e4fff5', s: '#6dd6cb', d: '#397c85', c: '#ef8e83' };
// The wraith's own cast magenta (pixel-v3 wraith.png): enemies alone wear magenta.
const WRAITH = { l: '#ff81f4', s: '#f254f2', d: '#b11ab1' };
const ORB = ['..llss..', '.lllsss.', 'llsssssd', 'lsssssdd', 'sssssddd', 'ssssdddd', '.sddddd.', '..dddd..'];

function paint(rows, palette, outline = true) {
  const height = rows.length, width = rows[0].length, data = new Uint8Array(width * height * 4);
  const filled = (i, j) => i >= 0 && j >= 0 && i < width && j < height && rows[j][i] !== '.';
  const set = (i, j, hex) => data.set([...[1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)), 255], (j * width + i) * 4);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    if (filled(i, j)) set(i, j, palette[rows[j][i]]);
    else if (outline && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => filled(i + di, j + dj))) set(i, j, INK);
  }
  return { width, height, data };
}

// A 16 × 16 weapon icon (0.5 u): bronze knuckles or a staff, with a rarity-coloured inlay.
// `anchor` is the row that rests on the ground.
export function itemIconPixels(family, rarity = 'common') {
  const palette = { ...(family === 'staff' ? WOOD : BRONZE), r: rarityInk(rarity), o: INK };
  let rows;
  if (family === 'staff') {
    const grid = Array.from({ length: 16 }, () => Array(16).fill('.'));
    // Two-pixel shaft from bottom left to top right: bone ferrules, the inlay at the grip and the head.
    for (let t = 0; t < 12; t++) {
      const x = 2 + t, y = 13 - t, part = t === 0 || t === 10 ? 'b' : t === 5 || t === 6 || t === 11 ? 'r' : null;
      grid[y][x] = part ?? 'a'; grid[y][x + 1] = part ?? 'c';
    }
    grid[1][14] = 'r';
    rows = grid.map(row => row.join(''));
  } else {
    // Four finger rings over the bar, the grip below.
    rows = [
      '................', '................', '................', '................', '................',
      '................', '................', '..aa.aa.aa.aa...', '.a..a..a..a..b..', '.b..b..b..b..c..',
      '.abbbbbbbbbbbc..', '..ccccccccccc...', '....brrrrrc.....', '.....ccccc......', '................',
      '................',
    ];
  }
  return { ...paint(rows, palette), anchor: 15 };
}

// An 8 × 8 monk shot (a quarter unit): a turquoise palm with a coral heart, or the reflected orb.
export function monkShotPixels(kind = 'palm') {
  const rows = kind === 'palm'
    ? ['.l.l.l..', '.s.s.s.l', '.ssssss.', 'lssccsss', '.sccccs.', '.ssccs..', '..sss...', '...s....']
    : ORB;
  return { ...paint(rows, SPIRIT, false), anchor: 4 };
}

// The spirit shot of a wraith (§2.3): the same 8 px orb in magenta.
export function wraithShotPixels() {
  return { ...paint(ORB, WRAITH, false), anchor: 4 };
}

// Atlas frames of one item on the ground (pixel-v12): a relic draws its relic, any other item its
// base; rarity picks the ring and beam pair. glintOffset is the glint pixel minus the anchor in
// source pixels (right, down). Null when the package has no drawing for the item.
const lootFrame = name => LOOT_GROUND.lootGround.frames.indexOf(name);
export const LOOT_STACK = Object.freeze([...LOOT_GROUND.stack]);
export function lootGroundFrames(item) {
  const name = item?.relic ? LOOT_GROUND.relics[item.relic] : LOOT_GROUND.weapons[item?.base];
  const frame = LOOT_GROUND.frames[name], rarity = LOOT_GROUND.rarity[item?.rarity] ?? LOOT_GROUND.rarity.common;
  if (!frame || frame.kind !== 'item') return null;
  const [ax, ay] = LOOT_GROUND.lootGround.anchor;
  return { item: lootFrame(name), shadow: lootFrame(frame.shadow), ring: rarity.ring.map(lootFrame), beam: rarity.beam.map(lootFrame),
    glint: LOOT_GROUND.glint.map(lootFrame), glintOffset: [frame.glint[0] - ax, frame.glint[1] - ay], bounds: frame.opaqueBounds };
}
// The cloth centre from the E point. The point lies screen-down of the cache (world +x +y), .45u past
// its +x face; .35u further along +x the cloth clears the collider and the cache drawing covers none of it.
export const SUPPLIES_CLOTH_SHIFT = Object.freeze({ x: .35, y: 0 });
export const suppliesClothCenter = (offset = { x: 0, y: 0 }) => ({
  x: CAMP_SUPPLIES.x + offset.x + SUPPLIES_CLOTH_SHIFT.x, y: CAMP_SUPPLIES.y + offset.y + SUPPLIES_CLOTH_SHIFT.y,
});
// A shift of (right, down) source pixels inside a flat ground drawing, as a world offset (GROUND_BASIS).
export const groundDrawingOffset = (right, down) => ({
  x: (-right * Math.SQRT1_2 + down * Math.SQRT2) / PIXELS_PER_UNIT, y: (right * Math.SQRT1_2 + down * Math.SQRT2) / PIXELS_PER_UNIT,
});

// Procedural art of one key shares a texture; the last billboard using it releases it.
const pixelTextures = new WeakMap();
export function createPixelBillboard(scene, name, key, draw) {
  if (!pixelTextures.has(scene)) pixelTextures.set(scene, new Map());
  const cache = pixelTextures.get(scene);
  let entry = cache.get(key);
  if (!entry) {
    const art = draw(), flipped = new Uint8Array(art.data.length), stride = art.width * 4;
    // Texture row 0 is the bottom of the plane.
    for (let j = 0; j < art.height; j++) flipped.set(art.data.subarray(j * stride, (j + 1) * stride), (art.height - 1 - j) * stride);
    const texture = RawTexture.CreateRGBATexture(flipped, art.width, art.height, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    texture.name = `pixel-${key}`;
    // The first material is attached below; skip the scene-wide hasAlpha scan.
    texture._hasAlpha = true;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    cache.set(key, entry = { texture, art, users: 0 });
  }
  entry.users++;
  const { art } = entry;
  const mesh = MeshBuilder.CreatePlane(name, { width: art.width / PIXELS_PER_UNIT, height: art.height / PIXELS_PER_UNIT }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, (art.anchor - art.height / 2) / PIXELS_PER_UNIT, 0));
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.renderingGroupId = 1;
  const material = flatMaterial(scene, `${name}-ink`, '#ffffff', material => {
    material.diffuseTexture = entry.texture;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHATEST;
    material.alphaCutOff = .5;
    material.backFaceCulling = false;
  });
  mesh.material = material;
  mesh.onDisposeObservable.addOnce(() => {
    material.dispose();
    if (--entry.users > 0) return;
    entry.texture.dispose();
    if (cache.get(key) === entry) cache.delete(key);
  });
  return { mesh, material };
}

export const legacyWorld = {
  id: 'legacy', tiles: TILES, pillars: PILLARS, braziers: BRAZIERS,
  shrine: SHRINE, exit: EXIT, portals: [], secret: null, ritual: null, reward: null,
};

// Camp NPCs own two draw calls, independent of static-prop batching. Baking
// the fixed camera's billboard basis into each quad preserves each NPC's real
// anchor depth. Alpha test writes depth, so actors and props sort per pixel,
// rather than sorting the three inhabitants as one transparent object.
export function createCampNpcs(scene, atlas, offset) {
  const placements = campNpcPlacements(offset), count = placements.length;
  const template = spritePlane(scene, 'camp-npc-template', atlas);
  scene.activeCamera?.getViewMatrix(true);
  const build = (name, ground) => {
    const mesh = new Mesh(name, scene), data = new VertexData();
    data.positions = []; data.normals = []; data.indices = [];
    data.uvs = new Float32Array(count * 8);
    if (!ground) data.colors = new Float32Array(count * 16).fill(1);
    template.billboardMode = ground ? Mesh.BILLBOARDMODE_NONE : Mesh.BILLBOARDMODE_ALL;
    for (let i = 0; i < count; i++) {
      const at = placements[i], part = VertexData.ExtractFromMesh(template, true, true);
      if (ground) part.transform(GROUND_BASIS);
      template.position.set(at.x, ground ? .02 : .025, at.y);
      part.transform(template.computeWorldMatrix(true));
      data.positions.push(...part.positions); data.normals.push(...part.normals);
      data.indices.push(...part.indices.map(index => index + i * 4));
      writeCampNpcUvs(data.uvs, i, atlas, ground ? atlas.shadowFrame : campNpcFrame(atlas, at, 0), !ground && at.flip);
    }
    data.applyToMesh(mesh, !ground);
    mesh.isPickable = false;
    mesh.renderingGroupId = ground ? 0 : 1;
    mesh.material = flatMaterial(scene, `${name}-ink`, '#ffffff', material => {
      material.diffuseTexture = atlas.texture;
      material.useAlphaFromDiffuseTexture = true;
      material.transparencyMode = ground ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST;
      material.alphaCutOff = .5;
      material.alpha = ground ? .46 : 1;
      material.backFaceCulling = false;
    });
    return { mesh, data };
  };
  let bodies, shadows;
  try { bodies = build('camp-npc-bodies', false); shadows = build('camp-npc-shadows', true); }
  finally { template.dispose(); }
  const body = bodies.mesh, shadow = shadows.mesh, uvs = bodies.data.uvs, colors = bodies.data.colors;
  const shown = placements.map(at => campNpcFrame(atlas, at, 0)), tint = Color3.White();
  let lit = null, previousLights = null, disposed = false;
  return { body, shadow, placements,
    update(time, graphics = {}, reducedMotion = false, lights = []) {
      if (disposed) return;
      shadow.setEnabled(graphics.propShade !== false);
      let changed = false;
      for (let i = 0; i < count; i++) {
        const at = placements[i], frame = campNpcFrame(atlas, at, time, reducedMotion);
        if (frame === shown[i]) continue;
        shown[i] = frame; changed = true;
        writeCampNpcUvs(uvs, i, atlas, frame, at.flip);
      }
      if (changed) body.updateVerticesData(VertexBuffer.UVKind, uvs, false, false);
      const pools = graphics.lightPools !== false;
      if (pools !== lit || lights !== previousLights) {
        lit = pools; previousLights = lights;
        for (let i = 0; i < count; i++) {
          const at = placements[i], light = pools && lightAt(lights, at.x, at.y);
          tint.set(1, 1, 1);
          if (light) tintEmissive(tint, light, .55); // Same soft tint as camp props.
          for (let j = 0; j < 4; j++) colors.set([tint.r, tint.g, tint.b, 1], i * 16 + j * 4);
        }
        body.updateVerticesData(VertexBuffer.ColorKind, colors, false, false);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      body.dispose(); shadow.dispose();
      body.material.dispose(); shadow.material.dispose(); // Atlas remains asset-loader owned.
    },
  };
}

export function buildPixelWorld(scene, assets, data = legacyWorld) {
  return batchMaterials(scene, () => buildWorld(scene, assets, data));
}

function buildWorld(scene, assets, data) {
  const resourceKinds = ['meshes', 'multiMaterials', 'materials', 'textures'];
  const before = Object.fromEntries(resourceKinds.map(key => [key, new Set(scene[key])]));
  let landscape, zones;
  captureStaticSpriteState(StandardMaterial, Texture, Observable, () => {
    landscape = data.id === 'legacy' ? null : buildLandscape(scene, assets, data);
    zones = (data.zones ?? [data]).map((zone, index) => buildPixelZone(scene, assets, zone, landscape, index === 0));
  }, scene);
  const built = zones[0];
  if (data.zones) {
    for (const key of ['columns', 'fires', 'props', 'portals', 'caches', 'shrines']) built[key] = zones.flatMap(zone => zone[key]);
    for (const key of ['gate', 'reward', 'ritual', 'supplies']) built[key] = zones.find(zone => zone[key])?.[key] ?? null;
    built.bounds = landscape.bounds;
  }
  // The first cache and shrine (the road's in the union) keep their single names.
  built.secret = built.caches[0] ?? null;
  built.shrine = built.shrines[0]?.sprite ?? null;
  // Only presentation reads these spots; they never become world bodies.
  const campZone = (data.zones ?? [data]).find(zone => zone.id === 'camp');
  built.campNpcs = campZone && assets.campNpcs ? createCampNpcs(scene, assets.campNpcs, campZone.offset) : null;
  const owned = Object.fromEntries(resourceKinds.map(key => [key, scene[key].filter(item => !before[key].has(item))]));
  let disposed = false, staticBatch;
  // Renderer.freezeWorld and updateOcclusion finish before scene.render. Defer
  // instancing until then, and refresh after the original per-sprite effects.
  const batchObserver = scene.onBeforeRenderObservable.add(() => {
    if (!staticBatch && !built.props?.every(sprite => sprite.mesh.isWorldMatrixFrozen)) return;
    staticBatch ??= batchMaterials(scene, () => new StaticSpriteBatch(scene, built, { scheduleObservation: step => scheduleStaticObservation(scene, step) }));
    staticBatch.update();
  });
  // `meshes` lists every mesh this world owns, for the renderer's one-time freeze of static scenery.
  return { ...built, data, meshes: owned.meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(batchObserver);
      staticBatch?.dispose();
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
      // The road country uses the camp's v9 art: standing props share the
      // actors' depth like the camp's, flat tufts lie on the ground.
      const v4 = assets.landscape.frames.includes(p.frame);
      const atlas = [assets.landscape, assets.campPanorama, assets.monasteryRuins].find(a => a?.frames.includes(p.frame));
      const name = `landscape-${p.frame}-${i}`, frame = atlas.frames.indexOf(p.frame);
      const sprite = v4 ? placeLandscape(name, frame, p.x, p.y, p.height) : place(name, frame, p.x, p.y, atlas);
      setSpriteFrame(sprite, { frame: sprite.frame, flip: p.flip });
      sprite.mesh.scaling.setAll(p.scale ?? 1);
      if (p.layer === 'ground') layOnGround(sprite);
      if (p.border) sprite.borderPlacement = p;
    }
    landscape.details = buildCountryDetails(scene, assets.countryDetails, landscape.groundCover);
  }
  // Authored areas (the camp and the ruined courtyard) own all of their props.
  // Braziers are drawn below from `braziers`; their entries only carry colliders.
  const authored = !!data.setDressing, side = !!PROP_ATLASES[data.id];
  const prefix = camp ? 'camp' : side ? data.id : 'court';
  const propAtlases = (PROP_ATLASES[data.id] ?? ['camp', 'campPanorama', 'monasteryRuins', 'landscape']).map(name => assets[name]);
  const campProps = authored ? data.setDressing.filter(p => p.kind !== 'brazier').map(p => {
    const atlas = propAtlases.find(a => a?.frames.includes(p.kind));
    if (!atlas) throw new Error(`Unknown ${data.id} prop: ${p.kind}`);
    const frame = atlas.frames.indexOf(p.kind);
    const sprite = place(`${prefix}-${p.id}`, frame, p.x, p.y, atlas);
    sprite.placement = p;
    // A low prop (a pixel-v13 footprint role) never hides an actor: it is never faded.
    if (atlas.footprints?.[p.kind]?.role === 'low') sprite.noFade = true;
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
    : authored ? campProps.filter(sprite => /^column-\d+$/.test(sprite.placement.id))
      // Road pillars: the camp's ruined pillar, its plinth on the unchanged collider.
      : road ? data.pillars.map((p, i) => {
        const art = roadPillar(p), atlas = assets.campPanorama;
        const sprite = place(`column-${i}`, atlas.frames.indexOf(art.frame), art.x, art.y, atlas);
        sprite.mesh.scaling.setAll(art.scale);
        setSpriteFrame(sprite, { frame: sprite.frame, flip: art.flip });
        return sprite;
      })
        : data.pillars.map((p, i) => place(`column-${i}`, 2, p.x + columnOffset, p.y + columnOffset));
  const minX = Math.min(...data.tiles.map(p => p.x)), maxX = Math.max(...data.tiles.map(p => p.x));
  const minY = Math.min(...data.tiles.map(p => p.y)), maxY = Math.max(...data.tiles.map(p => p.y));
  if (data.id === 'legacy') place('rear-ruin', 0, -5.25, -5.25);
  else if (!authored) {
    // Isolated old ruins retain their anchors on the continuous outdoor ground.
    const ruin = (name, frame, x, y) => placeLandscape(name, frame, x, y,
      landscape.cells.get(`${Math.round(x)},${Math.round(y)}`).height, assets.environment);
    // The road's ruined gate is part of its country (road-country.js).
    if (!road) {
      ruin('monastery-west-ruin', 0, minX - 3, minY - 2);
      ruin('monastery-east-ruin', 1, maxX + 3, minY - 2);
    }
  }
  const gateAtlas = data.id === 'legacy' ? assets.world : assets.environment;
  const authoredGate = campProps.find(sprite => sprite.placement.id === 'arch');
  const gate = authoredGate ?? (!road && !camp && !side && data.exit
    ? place('monastery-gate', data.id === 'legacy' ? gateAtlas.clips.gate.front[0] : gateAtlas.frames.indexOf('arch'),
      data.exit.x, data.exit.y - .5, gateAtlas) : null);
  // Braziers and the healing shrine use the restyled pixel-v11 world frames
  // (same clips, cells and contacts as v2); the legacy slice keeps v2.
  const worldArt = data.id === 'legacy' ? assets.world : assets.monasteryWorld ?? assets.world;
  const shrines = shrinesOf(data).map(({ id, x, y }) =>
    ({ id, x, y, sprite: place('healing-shrine', worldArt.clips.shrine.front[0], x - .5, y - .5, worldArt) }));

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
  const portals = (data.portals ?? []).map(p => ({ ...p, ring: ring(`portal-${p.id}`, p.x, p.y, .62, markerInk) }));
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
  }) : (data.braziers ?? []).map((b, i) => {
    if (b.color !== 'amber') {
      const clip = b.color === 'cyan' ? 'brazier-cyan' : 'brazier-magenta';
      return { ...b, clip, sprite: place(`brazier-${i}`, worldArt.clips[clip].front[0], b.x, b.y, worldArt) };
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

  // Three draws replace four box/ring draws. UV animation keeps all world matrices static.
  // Keep these out of props: the old caches were never picked or faded as scenery.
  const caches = cachesOf(data).map(({ id, x, y }) => {
    const sprite = createSprite(scene, `cache-${id}`, assets.cache);
    const motes = createSprite(scene, `cache-motes-${id}`, assets.cache, CACHE_FRAMES.motes);
    const pool = createSprite(scene, `cache-pool-${id}`, assets.cache, CACHE_FRAMES.pool);
    sprite.mesh.position.set(x, propHeight, y);
    motes.mesh.position.copyFrom(sprite.mesh.position);
    motes.material.zOffset = -1;
    layOnGround(pool);
    pool.mesh.position.set(x, .018, y);
    for (const effect of [motes, pool]) {
      effect.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
      effect.material.disableDepthWrite = true;
    }
    return { id, x, y, sprite, chest: sprite.mesh, motes, pool, glow: new CacheGlow() };
  });
  let reward = null;
  if (data.reward) {
    const p = data.reward, brass = material('reward-amber', '#ffd390');
    if (!camp) box('bead-offering-stone', p.x, p.y, .16, .55, .55, .32, trim);
    const bead = MeshBuilder.CreateSphere('amber-bead', { diameter: .18, segments: 4 }, scene);
    bead.position.set(p.x, .65, p.y); bead.material = brass; bead.isPickable = false;
    reward = { bead, ring: ring('reward-inlay', p.x, p.y, .5, brass) };
  }

  let ritual = null;
  // The authored courtyard sets its source in the socket of a low ruined dais.
  const dais = campProps.find(sprite => sprite.placement.id === 'ritual-plinth');
  if (data.ritual || data.id === 'legacy') {
    const p = data.ritual || { x: 0, y: 0 };
    // Native pixel seal: shared stone vocabulary, quiet behind moving actors.
    // A dais carries its own carving, so its seal ink stays empty.
    const seal = new DynamicTexture('ritual-seal', 128, scene, false, Texture.NEAREST_SAMPLINGMODE);
    const c = seal.getContext();
    c.clearRect(0, 0, 128, 128); c.strokeStyle = '#a09789'; c.lineWidth = 1;
    if (!dais) {
      for (const radius of [44, 49]) { c.beginPath(); c.arc(64, 64, radius, 0, Math.PI * 2); c.stroke(); }
      c.beginPath(); c.moveTo(64, 34); c.lineTo(94, 64); c.lineTo(64, 94); c.lineTo(34, 64); c.closePath(); c.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        c.fillStyle = '#a09789'; c.fillRect(Math.round(63 + Math.cos(a) * 39), Math.round(63 + Math.sin(a) * 39), 2, 2);
      }
    }
    seal.hasAlpha = true; seal.update();
    const ink = material('seal-ink', '#ffffff');
    ink.diffuseTexture = seal; ink.useAlphaFromDiffuseTexture = true; ink.transparencyMode = Material.MATERIAL_ALPHATEST;
    const sealMesh = MeshBuilder.CreateGround('seal', { width: 4, height: 4 }, scene);
    sealMesh.material = ink; sealMesh.position.set(p.x, .012, p.y); sealMesh.isPickable = false;
    if (data.ritual) {
      const glow = material('ritual-binding', '#ba719c');
      // On a dais the bindings lie on its rim and the posts stand on its
      // corners, around the socket that holds the source.
      const rim = dais?.placement.rim, lift = rim?.height ?? 0;
      const radii = rim ? [.3, .6].map(t => rim.inner + (rim.outer - rim.inner) * t) : [1.1, 1.3];
      const rings = radii.map((radius, i) => ring(`ritual-binding-${i}`, p.x, p.y, radius, glow, lift + .045));
      const shards = Array.from({ length: 4 }, (_, i) => {
        // Posts stand on the rim just beyond the socket's corners.
        const a = i * Math.PI / 2 + Math.PI / 4, reach = rim ? rim.inner * Math.SQRT2 + .25 : 1.2;
        const shard = box('ritual-seal-post', p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach, lift + .27, .13, .13, .54, glow);
        shard.rotation.z = .12; return shard;
      });
      ritual = { seal: sealMesh, ink: glow, rings, shards };
      // A raised dais (footprint `standOn`) would lift the source sprite.
      ritual.standOn = dais?.placement.standOn ?? 0;
    }
  }
  if (dais && ritual) {
    // The rune frame glows while the guards hold the seal, i.e. while the
    // renderer shows the seal posts; once it opens the dais is plain stone.
    const lit = dais.atlas.frames.indexOf('ritual-plinth-runes'), plain = dais.atlas.frames.indexOf(dais.placement.kind);
    const observer = scene.onBeforeRenderObservable.add(() => setSpriteFrame(dais,
      { frame: ritual.shards[0].isVisible ? lit : plain, flip: dais.flip }));
    dais.mesh.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(observer));
  }

  // The camp supplies cloth (pixel-v12) lies flat in front of the cache with the E point
  // (CAMP_SUPPLIES) on it. The renderer shows it empty once the supplies are taken.
  let supplies = null;
  if (camp && assets.campSupplies && !assets.campSupplies.failed) {
    const atlas = assets.campSupplies, at = suppliesClothCenter(data.offset);
    supplies = createSprite(scene, 'camp-supplies-cloth', atlas, atlas.frames.indexOf(atlas.full));
    layOnGround(supplies);
    supplies.mesh.position.set(at.x, .016, at.y);
  }

  return { data, columns, gate, shrines, fires, props, portals, caches, reward, ritual, supplies, landscape, floor: merged[0],
    bounds: { minX, maxX, minY, maxY },
  };
}
