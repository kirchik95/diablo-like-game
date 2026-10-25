// Presentation only. URL overrides are visit-local; only a player choice is saved.
export const TIERS = Object.freeze(['off', 'low', 'high']);
export const HD_STORAGE_KEY = 'ritual-hd';
const validTier = value => TIERS.includes(value);
const validId = value => /^[a-z][a-z0-9-]*$/.test(value);

export function defaultTier({ coarse = false, phone = false } = {}) {
  return coarse || phone ? 'low' : 'high';
}

export function normalizeSettings(value, fallback = 'off') {
  const tier = validTier(value) ? value : validTier(value?.tier) ? value.tier : fallback;
  const overrides = {};
  if (value?.overrides && typeof value.overrides === 'object') {
    for (const [id, level] of Object.entries(value.overrides)) {
      if (validId(id) && validTier(level)) overrides[id] = level;
    }
  }
  return { tier, overrides };
}

export function parseHD(value, base) {
  const settings = normalizeSettings(base);
  if (validTier(value)) return { tier: value, overrides: {} };
  if (typeof value !== 'string' || !value) return settings;
  for (const token of value.split(',')) {
    const parts = token.trim().split(':');
    if (parts.length === 2 && validId(parts[0]) && validTier(parts[1])) settings.overrides[parts[0]] = parts[1];
  }
  return settings;
}

export function effectTier(settings, id) {
  return settings.overrides && Object.hasOwn(settings.overrides, id) ? settings.overrides[id] : settings.tier;
}

export function createTierSettings({ storage = null, search = '', coarse = false, phone = false } = {}) {
  let saved = null;
  try {
    const value = storage?.getItem(HD_STORAGE_KEY);
    saved = validTier(value) ? value : value ? JSON.parse(value) : null;
  } catch { /* Storage denial or an older/corrupt preference keeps the device default. */ }
  return parseHD(new URLSearchParams(search).get('hd'), normalizeSettings(saved, defaultTier({ coarse, phone })));
}

export function saveTierSettings(storage, settings) {
  try {
    if (!storage) return false;
    storage.setItem(HD_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch { return false; }
}
