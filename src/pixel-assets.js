import environmentPackage from '../assets/game/pixel-v1/manifest.json' with { type: 'json' };
import monkPackage from '../assets/game/pixel-v10/monk-side/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };
import wraithPackage from '../assets/game/pixel-v3/wraith/manifest.json' with { type: 'json' };
import beetlePackage from '../assets/game/pixel-v7/beetle/manifest.json' with { type: 'json' };
import landscapePackage from '../assets/game/pixel-v4/landscape/manifest.json' with { type: 'json' };
import campPackage from '../assets/game/pixel-v5/camp/manifest.json' with { type: 'json' };
import countryPackage from '../assets/game/pixel-v6/country/manifest.json' with { type: 'json' };
import panoramaPackage from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruinsPackage from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };

// Shared by the renderer and the 2D developer preview; no GPU initialization.
export const PIXELS_PER_UNIT = environmentPackage.nativePixelsPerUnit;
export const pixelAtlases = {
  monk: monkPackage.monk, hound: houndPackage.hound, world: houndPackage.world, effects: houndPackage.effects,
  environment: environmentPackage.environment, floor: environmentPackage.floor,
  wraith: wraithPackage.wraith,
  beetle: beetlePackage.beetle,
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
};
export const pixelAssetUrls = {
  monk: new URL('../assets/game/pixel-v10/monk-side/monk-side.png', import.meta.url).href,
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
};
