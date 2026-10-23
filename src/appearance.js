import manifest from '../assets/game/pixel-v3/appearance/manifest.json' with { type: 'json' };

const options = values => Object.freeze(values.map(value => Object.freeze({ ...value })));

export const appearanceOptions = Object.freeze({
  skins: options(manifest.skins),
  hair: options(manifest.hair),
  sashes: options(manifest.sashes),
  default: Object.freeze({ ...manifest.default }),
});

const choices = {
  skin: new Set(appearanceOptions.skins.map(option => option.id)),
  hair: new Set(appearanceOptions.hair.map(option => option.id)),
  sash: new Set(appearanceOptions.sashes.map(option => option.id)),
};

// Textures are the 110-key side-package atlases (v3 rows 0-9 plus the idle/run side row),
// matching the shared monk geometry in pixel-assets.js. Vite bundles every file a URL
// template can match, so both templates name the exact file pattern: the v3 folder ships
// only its small previews, not its 100-key atlases.
const variants = new Map(manifest.variants.map(variant => [variant.id, Object.freeze({
  ...variant,
  url: new URL(`../assets/game/pixel-v10/monk-side/appearance/${variant.id}.png`, import.meta.url).href,
  previewUrl: new URL(`../assets/game/pixel-v3/appearance/${variant.id}-preview.png`, import.meta.url).href,
})]));

export function normalizeAppearance(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(choices).map(([key, allowed]) => [
    key, allowed.has(source[key]) ? source[key] : appearanceOptions.default[key],
  ]));
}

export function appearanceVariant(value) {
  const { skin, hair, sash } = normalizeAppearance(value);
  return variants.get(`${skin}-${hair}-${sash}`);
}
