import environmentPackage from '../assets/game/pixel-v1/manifest.json' with { type: 'json' };
import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };
import monkV3Package from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };
import wraithPackage from '../assets/game/pixel-v3/wraith/manifest.json' with { type: 'json' };
import beetlePackage from '../assets/game/pixel-v7/beetle/manifest.json' with { type: 'json' };
import landscapePackage from '../assets/game/pixel-v4/landscape/manifest.json' with { type: 'json' };
import campPackage from '../assets/game/pixel-v5/camp/manifest.json' with { type: 'json' };
import countryPackage from '../assets/game/pixel-v6/country/manifest.json' with { type: 'json' };
import panoramaPackage from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruinsPackage from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import lootPackage from '../assets/game/pixel-v12/loot-ground/manifest.json' with { type: 'json' };
import cemeteryPackage from '../assets/game/pixel-v13/cemetery/manifest.json' with { type: 'json' };
import orchardPackage from '../assets/game/pixel-v13/orchard/manifest.json' with { type: 'json' };
import cachePackage from '../assets/game/pixel-v15/cache/manifest.json' with { type: 'json' };
// Ambient camp inhabitants: one shared atlas for the body and shadow batches.
import campNpcPackage from '../assets/game/pixel-v18/camp-npcs/manifest.json' with { type: 'json' };

// Shared by the renderer and the 2D developer preview; no GPU initialization.
export const PIXELS_PER_UNIT = environmentPackage.nativePixelsPerUnit;
export const pixelAtlases = {
  campNpcs: campNpcPackage.campNpcs,
  monk: monkPackage.monk, hound: houndPackage.hound, world: houndPackage.world, effects: houndPackage.effects,
  environment: environmentPackage.environment, floor: environmentPackage.floor,
  wraith: wraithPackage.wraith,
  beetle: beetlePackage.beetle,
  cache: cachePackage.cache,
  landscape: landscapePackage.landscape,
  ...landscapePackage.surfaces,
  camp: campPackage.camp,
  campFlame: { ...campPackage.campFlame, animation: campPackage.animations.campfire },
  ...countryPackage.surfaces,
  countryDetails: countryPackage.countryDetails,
  campPanorama: panoramaPackage.campPanorama,
  campBackdrop: panoramaPackage.campBackdrop,
  ...panoramaPackage.surfaces,
  monasteryRuins: ruinsPackage.monasteryRuins,
  // The v2 world layout redrawn in the camp palette: braziers, ritual source, shrine.
  monasteryWorld: ruinsPackage.monasteryWorld,
  ...ruinsPackage.surfaces,
  // The side zones (pixel-v13). Footprints give each frame's role: a 'low' prop never fades over an
  // actor. Their ground surfaces stay unregistered until the ground shader reads them.
  cemetery: { ...cemeteryPackage.cemetery, footprints: cemeteryPackage.footprints },
  orchard: { ...orchardPackage.orchard, footprints: orchardPackage.footprints },
};
export const pixelAssetUrls = {
  campNpcs: new URL('../assets/game/pixel-v18/camp-npcs/camp-npcs.png', import.meta.url).href,
  cache: new URL('../assets/game/pixel-v15/cache/cache.png', import.meta.url).href,
  monk: new URL('../assets/game/pixel-v17/monk-side/monk-side.png', import.meta.url).href,
  hound: new URL('../assets/game/pixel-v2/hound-world/hound-v2.png', import.meta.url).href,
  world: new URL('../assets/game/pixel-v2/hound-world/world-v2.png', import.meta.url).href,
  effects: new URL('../assets/game/pixel-v2/hound-world/effects-v2.png', import.meta.url).href,
  environment: new URL('../assets/game/pixel-v1/environment.png', import.meta.url).href,
  floor: new URL('../assets/game/pixel-v1/floor.png', import.meta.url).href,
  wraith: new URL('../assets/game/pixel-v3/wraith/wraith.png', import.meta.url).href,
  beetle: new URL('../assets/game/pixel-v7/beetle/beetle.png', import.meta.url).href,
  landscape: new URL('../assets/game/pixel-v4/landscape/landscape.png', import.meta.url).href,
  earth: new URL('../assets/game/pixel-v4/landscape/earth.png', import.meta.url).href,
  moss: new URL('../assets/game/pixel-v4/landscape/moss.png', import.meta.url).href,
  cliff: new URL('../assets/game/pixel-v4/landscape/cliff.png', import.meta.url).href,
  camp: new URL('../assets/game/pixel-v5/camp/camp.png', import.meta.url).href,
  campFlame: new URL('../assets/game/pixel-v5/camp/camp-flame.png', import.meta.url).href,
  countryGrass: new URL('../assets/game/pixel-v6/country/grass.png', import.meta.url).href,
  countrySoil: new URL('../assets/game/pixel-v6/country/soil.png', import.meta.url).href,
  countryStone: new URL('../assets/game/pixel-v6/country/stone.png', import.meta.url).href,
  countryDetails: new URL('../assets/game/pixel-v6/country/details.png', import.meta.url).href,
  campPanorama: new URL('../assets/game/pixel-v9/camp-panorama/camp-panorama.png', import.meta.url).href,
  campBackdrop: new URL('../assets/game/pixel-v9/camp-panorama/mountains.png', import.meta.url).href,
  campGrass: new URL('../assets/game/pixel-v9/camp-panorama/camp-grass.png', import.meta.url).href,
  campEarth: new URL('../assets/game/pixel-v9/camp-panorama/camp-earth.png', import.meta.url).href,
  monasteryRuins: new URL('../assets/game/pixel-v11/monastery-ruins/monastery-ruins.png', import.meta.url).href,
  monasteryWorld: new URL('../assets/game/pixel-v11/monastery-ruins/monastery-world.png', import.meta.url).href,
  courtyardFlagstone: new URL('../assets/game/pixel-v11/monastery-ruins/courtyard-flagstone.png', import.meta.url).href,
  cemetery: new URL('../assets/game/pixel-v13/cemetery/cemetery.png', import.meta.url).href,
  orchard: new URL('../assets/game/pixel-v13/orchard/orchard.png', import.meta.url).href,
};

// Loot on the ground (pixel-v12, §5.4): the item, shadow, ring, beam and glint atlas and the camp
// supplies cloth. Both are optional: loadPixelAssets marks a failed one and the renderer falls back
// to procedural icons; the world still loads. LOOT_GROUND is the package contract (frame names,
// rarity frames, stack order, timings).
export const LOOT_GROUND = lootPackage;
export const lootAtlases = { lootGround: lootPackage.lootGround, campSupplies: lootPackage.campSupplies };
export const lootAssetUrls = {
  lootGround: new URL('../assets/game/pixel-v12/loot-ground/loot-ground.png', import.meta.url).href,
  campSupplies: new URL('../assets/game/pixel-v12/loot-ground/camp-supplies.png', import.meta.url).href,
};

// Monk weapon layers (pixel-v12 monk-weapons, §3.8): knuckle bands and strikes, the held staff and
// the staff swings. The manifest is fetched, not bundled: its per-key rig data would push the main
// chunk over its size budget. loadPixelAssets treats the package as optional.
export const monkWeaponsManifestUrl = new URL('../assets/game/pixel-v17/monk-weapons/manifest.json', import.meta.url).href;
export const monkWeaponUrls = {
  knuckles: new URL('../assets/game/pixel-v17/monk-weapons/knuckles.png', import.meta.url).href,
  staff: new URL('../assets/game/pixel-v17/monk-weapons/staff.png', import.meta.url).href,
  staffAttacks: new URL('../assets/game/pixel-v17/monk-weapons/staff-attacks.png', import.meta.url).href,
};

// Dense monk animation is an atomic opt-in: the appearance and mask URL owners must
// switch alongside the body and weapon geometry. Legacy stays active until that merge.
export const monkAnimationV3 = {
  atlas: monkV3Package.monk,
  url: new URL('../assets/game/pixel-v17/monk-side/monk-side.png', import.meta.url).href,
  maskUrl: new URL('../assets/game/pixel-v17/monk-side/hit-masks.json', import.meta.url).href,
  weaponsManifestUrl: new URL('../assets/game/pixel-v17/monk-weapons/manifest.json', import.meta.url).href,
  weaponUrls: {
    knuckles: new URL('../assets/game/pixel-v17/monk-weapons/knuckles.png', import.meta.url).href,
    staff: new URL('../assets/game/pixel-v17/monk-weapons/staff.png', import.meta.url).href,
    staffAttacks: new URL('../assets/game/pixel-v17/monk-weapons/staff-attacks.png', import.meta.url).href,
  },
};
