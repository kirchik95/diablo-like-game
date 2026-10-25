// «Старое кладбище», east of the road, in local coordinates (OVERWORLD moves it by (28, -68)).
// Its gate opens onto the road's spur between road-approach and road-crossing. Rows are
// [id, kind, x, y] by contact centre (zone-dressing.js); docs/design/world-expansion.md §2.2, §4.2.
import { dressSideZone } from './zone-dressing.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const regions = [
  [-13, -10, 1, 4], [-9, 6, -3, 11], [-9, 3, 12, 16], [7, 13, -7, 8],
  [-7, 7, -14, -4], [-11, -8, -17, -11], [6, 11, -20, -8],
];

const rows = [
  // Landmarks and low obstacles inside the walk mask; flat grave art.
  ['gate', 'cemetery-gate-y', -8, 2], ['obelisk', 'obelisk', 0, -8],
  ['lantern-west', 'stone-lantern', -2.4, -6.4], ['lantern-east', 'stone-lantern', 2.4, -6.4],
  ['obelisk-ash', 'grave-ash', 2, -5.3],
  ['reliquary-altar', 'offering-stone', -7.2, -12.95], ['reliquary-urns', 'urn-pair', -5.8, -13.1],
  ['reliquary-lantern', 'stone-lantern-toppled', -7.9, -8.7],
  ['broken-obelisk', 'obelisk-broken', 6.6, -12.4], ['east-cairn', 'cairn-large', 8.1, 4.4],
  ['field-mound-west', 'grave-mound-x', -3.2, 4.6], ['field-mound-east', 'grave-mound-y', 3.4, -.8],
  ['south-slab', 'stele-fallen-x', 1, 10.3],
  ['plot-1', 'grave-plot-x', -3.6, 6.2], ['plot-2', 'grave-plot-y', 2, 5.4], ['plot-3', 'grave-plot-x', -1.6, 10],
  ['moss-1', 'moss-graves', 6.6, -2], ['moss-2', 'moss-graves', -4, 9.8], ['moss-3', 'moss-graves', 6, -10],
  ['slabs-gate', 'stepping-slabs', -5, 2], ['slabs-plaza', 'stepping-slabs', -.8, -2.6], ['slabs-nook', 'stepping-slabs', -5.2, -8.6],
  // North edge (back of the screen): yews and tall stelae.
  ['yew-nook', 'yew-round', -7.2, -14.7], ['stele-plaza-west', 'stele-low-x', -4.3, -11.3],
  ['yew-plaza-2', 'yew-round', -1.2, -12.1], ['stele-plaza', 'stele-tall-x', 1.6, -11.2],
  ['yew-plaza-3', 'yew-round', 2.6, -12.4], ['yew-clearing', 'yew-round', 6.2, -15.9],
  ['cypress-clearing', 'cypress-medium', 9.6, -16.6],
  // West edge: the road lies up the screen behind it, so it stays low but for a few props
  // with room behind them.
  ['west-stele-1', 'stele-low-y', -7.2, -1.2], ['west-cairn', 'cairn-small', -7.1, 4.8],
  ['west-stele-2', 'stele-leaning-y', -7.3, 6.8], ['west-fence', 'fence-broken-y', -7.2, 10],
  ['nook-stele', 'stele-tall-y', -8.9, -11.4], ['nook-yew', 'yew-small', -9, -8.6],
  ['plaza-yew', 'yew-round', -6.4, -5.4],
  // South and east edges (front of the screen): low fences and stelae.
  ['south-fence-1', 'fence-x', -5, 12], ['south-fence-2', 'fence-broken-x', -2, 12], ['south-fence-3', 'fence-x', 1, 12],
  ['south-stele', 'stele-low-x', 3.5, 9.1], ['wing-fence', 'fence-broken-x', 7, 7],
  ['east-fence-1', 'fence-y', 10, -4], ['east-fence-2', 'fence-broken-y', 10, -1],
  ['east-fence-3', 'fence-y', 10, 2], ['east-fence-4', 'fence-broken-y', 10, 5], ['clearing-fence', 'fence-broken-y', 9.2, -9.6],
  ['clearing-cairn', 'cairn-small', 9.1, -12.7], ['field-stele', 'stele-low-y', 5.2, 7.8],
];

// These clusters use the expanded frame's local coordinates. Grave plots and moss give the
// larger fields a burial rhythm without narrowing pack clearings or changing the paved routes.
const extensionRows = [
  ['south-plot-west', 'grave-plot-x', -7.3, 14.2], ['south-plot-middle', 'grave-plot-x', -5.1, 15.3],
  ['south-plot-east', 'grave-plot-y', .6, 12.4], ['south-moss', 'moss-graves', -7.4, 12.2],
  ['field-plot-west', 'grave-plot-x', -6.4, 10.5], ['field-plot-east', 'grave-plot-y', 1.2, 10.3],
  ['field-moss', 'moss-graves', 4.7, 9.5],
  ['wing-plot-north', 'grave-plot-y', 11.3, -4.2], ['wing-plot-south', 'grave-plot-y', 10.4, 1.2],
  ['wing-moss', 'moss-graves', 8.4, 5],
  ['clearing-plot-north', 'grave-plot-x', 8.4, -18.9], ['clearing-plot-east', 'grave-plot-y', 10.3, -16.1],
  ['clearing-moss', 'moss-graves', 7.7, -10.8], ['plaza-moss-west', 'moss-graves', -3.1, -12.1],
  ['plaza-moss-east', 'moss-graves', 5.4, -11.4],
  ['gate-slabs', 'stepping-slabs', -10.5, 3], ['plaza-slabs', 'stepping-slabs', -6, -5.8],
  ['nook-slabs', 'stepping-slabs', -10, -14.8], ['nook-moss', 'moss-graves', -9.2, -16],
  // A ruined funerary facade beyond the north edge. It is scenery, with no door or interaction.
  // The (+2, -2) screen-side shift keeps the window out of the foreground yew canopy.
  // The walls have empty ground behind them; their contacts are too far from the walk to collide.
  ['crypt-facade', 'wall-window-x', -1.5, -21.4], ['crypt-return', 'wall-end-y', -4.1, -23.1],
  ['crypt-lintel', 'fallen-lintel', -1.5, -18.7], ['crypt-offering', 'offering-stone', -3.4, -18.8],
  ['crypt-urns', 'urn-pair', .7, -20.9],
];

const tables = {
  edgeSmall: 'cairn-small',
  edge: [['bush-round', .35], ['cairn-small', .2], ['stele-low-x', .1], ['stele-low-y', .1], ['boulder-round', .15], ['stele-fallen-x', .1]],
  spill: [['stele-fallen-x', .2], ['stele-fallen-y', .15], ['cairn-small', .25], ['urn-broken', .15], ['stone-lantern-toppled', .1], ['grave-mound-x', .15]],
  near: [['bush-round', .45], ['cairn-small', .2], ['boulder-round', .15], ['stele-low-x', .1], ['stele-low-y', .1]],
  mid: [['yew-small', .3], ['bush-large', .25], ['bush-round', .2], ['cairn-large', .1], ['stele-tall-x', .15]],
  far: [['yew-round', .35], ['cypress-medium', .2], ['cypress-tall', .15], ['cypress-pair', .1], ['bush-large', .2]],
};

export const CEMETERY_LAYOUT = freeze({
  regions,
  pavingRoutes: [
    { width: 1.8, points: [[-13.5, 3], [-8, 3], [-6, 0], [-6, -10.5], [-7, -13], [-10, -15], [-10, -16]] },
    { width: 1.5, points: [[-6, -4], [-2, -6], [0, -8]] },
  ],
  spawn: { x: -11, y: 3 }, entries: { road: { x: -11, y: 3 } }, exit: null,
  secret: { x: -10, y: -16 },
  pillars: [], braziers: [],
  setDressing: dressSideZone('cemetery', { regions, rows: [...rows.map(([id, kind, x, y]) => [id, kind, x * 1.4, y * 1.4]), ...extensionRows], tables, salt: 300, outerDensity: .5 }),
});
