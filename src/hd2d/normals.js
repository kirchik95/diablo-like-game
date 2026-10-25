import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import manifest from '../../assets/game/hd2d-normals/manifest.json' with { type: 'json' };
import { pixelAssetUrls, lootAssetUrls, monkWeaponUrls } from '../pixel-assets.js';
import { appearanceOptions, appearanceVariant } from '../appearance.js';

export const id = 'normals';
export const order = 5;

// Only URL strings are bundled. No PNG is fetched or decoded during import/install.
// Equal geometry (appearance recolours) shares one URL and one GPU texture.
const bySource = new Map(), byKey = new Map(), byUrl = new Map(), byHash = new Map();
for (const source of manifest.atlases) {
  const canonical = byHash.get(source.sha256) ?? source.id;
  byHash.set(source.sha256, canonical);
  const entry = Object.freeze({ ...source,
    url: new URL(`../../assets/game/hd2d-normals/${canonical}.png`, import.meta.url).href,
  });
  bySource.set(source.source, entry);
  for (const key of source.keys) byKey.set(key, entry);
}
for (const [key, url] of Object.entries({ ...pixelAssetUrls, ...lootAssetUrls, ...monkWeaponUrls })) byUrl.set(url, byKey.get(key));
for (const skin of appearanceOptions.skins) for (const hair of appearanceOptions.hair) for (const sash of appearanceOptions.sashes) {
  const variant = appearanceVariant({ skin: skin.id, hair: hair.id, sash: sash.id });
  const entry = [...bySource.values()].find(entry => entry.appearanceId === variant.id);
  if (entry) byUrl.set(variant.url, entry);
}

/** Accept an albedo URL, Babylon Texture, or renderer atlas {texture}. */
export function normalMapFor(source) {
  const url = typeof source === 'string' ? source : source?.texture?.url ?? source?.url;
  return byUrl.get(url) ?? bySource.get(url) ?? byKey.get(url) ?? null;
}

const unavailable = Promise.resolve(null);

/** Demand cache; serial uploads limit high-tier decode/upload bursts on phones.
 * load() always resolves Texture|null. Call get() on material creation/rebind,
 * not on every sprite per frame. Never bind alpha as opacity: it stores height.
 */
export function createNormalLoader(transport) {
  const records = new Map(), queue = [];
  const stats = { textures: 0, gpuBytes: 0, queued: 0, inflight: 0, failed: 0, downloads: 0, downloadBytes: 0 };
  let tier = 'off', disposed = false, active = null;

  function pump() {
    if (active || disposed || tier !== 'high' || !queue.length) return;
    const record = active = queue.shift();
    stats.queued = queue.length;
    stats.inflight = 1;
    let request;
    try { request = transport(record.entry); } catch (error) { request = Promise.reject(error); }
    record.cancel = request?.cancel;
    Promise.resolve(request).then(texture => {
      if (record.canceled || disposed || tier !== 'high') { texture?.dispose(); return; }
      if (!texture) { stats.failed++; record.resolve(null); return; }
      record.texture = texture;
      stats.textures++;
      stats.gpuBytes += record.entry.gpuBytes;
      stats.downloads++;
      stats.downloadBytes += record.entry.downloadBytes;
      record.resolve(texture);
    }, () => {
      if (!record.canceled) { stats.failed++; record.resolve(null); }
    }).finally(() => {
      active = null;
      stats.inflight = 0;
      pump();
    });
  }

  function clear() {
    for (const record of records.values()) {
      record.canceled = true;
      record.cancel?.();
      record.texture?.dispose();
      record.resolve(null);
    }
    records.clear();
    queue.length = 0;
    stats.textures = stats.gpuBytes = stats.queued = stats.failed = 0;
  }

  return {
    stats,
    get tier() { return tier; },
    setTier(next) {
      if (!['off', 'low', 'high'].includes(next)) throw new RangeError(`Unknown normals tier: ${next}`);
      if (disposed || tier === next) return;
      tier = next;
      if (tier !== 'high') clear();
      else pump();
    },
    load(source) {
      const entry = normalMapFor(source);
      if (disposed || tier !== 'high' || !entry || !entry.relight) return unavailable;
      let record = records.get(entry.url);
      if (record) return record.promise;
      record = { entry, texture: null, canceled: false };
      record.promise = new Promise(resolve => { record.resolve = resolve; });
      records.set(entry.url, record);
      queue.push(record);
      stats.queued = queue.length;
      pump();
      return record.promise;
    },
    get(source) {
      if (disposed || tier !== 'high') return null;
      const entry = normalMapFor(source);
      return (entry && records.get(entry.url)?.texture) || null;
    },
    dispose() { if (disposed) return; disposed = true; tier = 'off'; clear(); },
  };
}

function loadNormalTexture(scene, entry) {
  let texture, settle;
  const pending = new Promise((resolve, reject) => {
    settle = resolve;
    texture = new Texture(entry.url, scene, {
      noMipmap: true, invertY: true, samplingMode: Texture.NEAREST_SAMPLINGMODE,
      onLoad: () => resolve(texture),
      onError: () => { texture.dispose(); reject(new Error(`Normal atlas unavailable: ${entry.id}`)); },
    });
    texture.gammaSpace = false;
    texture.hasAlpha = false;
    texture.wrapU = texture.wrapV = entry.tiled ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  });
  pending.cancel = () => { texture.dispose(); settle(null); };
  return pending;
}

// Service only: the lights owner decides where/how to sample normal/height data.
// This module never changes existing material, albedo, mesh, UV, alpha or picking.
export function install({ scene, renderer, tier = 'off' }) {
  const loader = createNormalLoader(entry => loadNormalTexture(scene, entry));
  const previous = renderer.hd2dNormals;
  renderer.hd2dNormals = loader;
  loader.setTier(tier);
  return {
    setTier: tier => loader.setTier(tier),
    update() {},
    dispose() {
      loader.dispose();
      if (renderer.hd2dNormals === loader) {
        if (previous === undefined) delete renderer.hd2dNormals;
        else renderer.hd2dNormals = previous;
      }
    },
  };
}
