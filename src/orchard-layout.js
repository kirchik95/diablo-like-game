// «Сад обители», west of the courtyard, in local coordinates (OVERWORLD moves it by (-28, -120),
// the courtyard's y offset). It opens through the breach in the courtyard's west wall. Rows are
// [id, kind, x, y] by contact centre (zone-dressing.js); docs/design/world-expansion.md §2.3, §4.3.
// The renderer draws the healing shrine itself, at `shrine`.
import { dressSideZone } from './zone-dressing.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const regions = [
  [14, 14, 1, 4], [13, 13, 0, 3], [11, 12, -2, 3],
  [-3, 10, -2, 13], [-8, 8, -17, -3], [-13, -4, -2, 9],
];

const rows = [
  // Landmarks and low obstacles inside the walk mask; flat orchard litter.
  ['press', 'olive-press', 2.5, 4.5], ['well', 'well', -1.2, -6.5],
  ['statue', 'monk-statue', -7, 3.4], ['old-olive', 'olive-tree-old', -4.4, -10.6],
  ['olive-1', 'olive-tree-a', 5.01, -11.01], ['olive-2', 'olive-tree-b', -4.6, -3.2],
  ['olive-3', 'olive-tree-c', 5.46, -5.46], ['olive-4', 'olive-tree-a', 7.21, 6.19],
  ['olive-5', 'olive-tree-b', -1.4, 8.3], ['fig', 'fig-young', -3.8, 5.4],
  ['pergola', 'pergola-y', 1.6, -.6],
  ['press-baskets', 'olive-baskets', 4.3, 6.3], ['press-jars', 'terracotta-jars', .6, 6.7],
  ['press-cart', 'cart-broken-x', 6, 10.35], ['well-basin', 'stone-basin', .4, -8],
  ['well-bench', 'garden-bench-y', -5.3, -8.4], ['herb-bed-1', 'herb-bed-x', 1.2, -11.2],
  ['herb-bed-2', 'herb-bed-overgrown', -7.4, 6], ['beehives', 'beehive-pair', -8.4, 6.9],
  ['olives-1', 'fallen-olives', 3, 2.2], ['olives-2', 'fallen-olives', 4.2, -6.4], ['litter-1', 'leaf-litter', -3, -9],
  ['litter-2', 'leaf-litter', -6, 1.6], ['gravel-1', 'gravel-path', 6.4, 1.4], ['gravel-2', 'gravel-path', -1.2, 3],
  ['branches', 'pruned-branches', 5, -1.2],
  // North and west edges (back of the screen): the orchard's stone wall and tall trees.
  ['north-wall-1', 'wall-run-x', -2.6, -13.4], ['north-wall-2', 'wall-window-x', 1.8, -13.4],
  ['north-wall-end', 'wall-end-x', 5.6, -13.4], ['wall-corner', 'wall-corner', -8.2, -14.2],
  ['west-wall-1', 'wall-run-y', -7.4, -9.4], ['west-wall-2', 'wall-end-y', -7.4, -5.1],
  ['terrace-wall', 'wall-run-y', -10.4, 2.4], ['terrace-ivy', 'ivy-clump', -10.1, 5.4],
  ['north-olive', 'olive-tree-c', 8.2, -13.6], ['north-cypress', 'cypress-medium', 9.6, -16.8],
  ['terrace-north-olive', 'olive-dead', -8.2, -2.6], ['terrace-cypress', 'cypress-pair', -12.6, -1.2],
  // South edge (front of the screen): low trellises, vines and a parapet.
  ['south-parapet', 'parapet-broken-x', 1.2, 10.1], ['south-trellis', 'trellis-x', -1.6, 10],
  ['south-vines', 'vine-clump', 4.2, 10.2], ['terrace-trellis', 'trellis-x', -6.2, 7],
  ['terrace-beehive', 'beehive-fallen', -3.6, 7.1],
  // East edge (front, behind the courtyard's back wall): low.
  ['east-parapet', 'parapet-broken-y', 8.2, 5.4], ['east-vines', 'vine-clump', 8.1, 8.6],
  ['garden-trellis', 'trellis-y', 7.1, -7.6], ['garden-bush', 'bush-round', 7.6, -10.9],
  ['corridor-rubble', 'fallen-block', 9.4, -1.8], ['corridor-ivy', 'ivy-clump', 9.6, 5.2],
];

// Flat harvest and pruning clusters fill the expanded districts. The press yard and the
// well's combat clearing keep their original trunks, colliders and paved approaches.
const extensionRows = [
  ['old-olive-leaves', 'leaf-litter', -5.6, -14], ['old-olive-fruit', 'fallen-olives', -6.3, -15.6],
  ['north-olive-fruit', 'fallen-olives', 6.4, -15], ['north-olive-leaves', 'leaf-litter', 7.2, -13.7],
  ['west-olive-fruit', 'fallen-olives', -6.4, -4.1],
  ['east-olive-fruit', 'fallen-olives', 7, -7.1], ['east-olive-leaves', 'leaf-litter', 7.1, -8.8],
  ['press-olive-leaves', 'leaf-litter', 9.4, 9.6], ['south-olive-fruit', 'fallen-olives', -1.8, 12],
  ['fig-leaves', 'leaf-litter', -4.7, 7.6],
  ['press-yard-gravel', 'gravel-path', 4.2, 5.4], ['press-harvest', 'fallen-olives', 6.6, 9.6],
  ['terrace-herb-leaves', 'leaf-litter', -10.3, 7.8], ['terrace-pruning', 'pruned-branches', -11.2, 5.8],
  ['north-pruning', 'pruned-branches', 3.9, -16.1], ['entry-gravel', 'gravel-path', 11.7, 1.8],
  ['well-garden-leaves', 'leaf-litter', -3.4, -7.7], ['well-garden-pruning', 'pruned-branches', -6.5, -11],
  // Native fruit-tree silhouettes beyond the western wall, and a low abandoned apiary.
  // These distant clusters obey the same height and ownership rules as the outer grove.
  ['west-grove-olive', 'olive-tree-b', -14.4, -12.1], ['west-grove-fig', 'fig-young', -17.3, -7.8],
  ['apiary-hives', 'beehive-pair', -15.5, 11.8], ['apiary-fallen', 'beehive-fallen', -17.3, 11.6],
  ['apiary-baskets', 'olive-baskets', -15.5, 13.4],
];

const tables = {
  edgeSmall: 'rubble-small',
  edge: [['bush-round', .4], ['vine-clump', .3], ['rubble-small', .15], ['fallen-block', .15]],
  spill: [['fallen-block', .3], ['rubble-pile', .2], ['ivy-clump', .25], ['beehive-fallen', .1], ['terracotta-jars', .15]],
  near: [['bush-round', .45], ['vine-clump', .25], ['fallen-block', .15], ['boulder-round', .15]],
  mid: [['olive-tree-a', .25], ['olive-tree-b', .2], ['fig-young', .15], ['bush-large', .25], ['olive-dead', .15]],
  far: [['olive-tree-c', .2], ['olive-tree-a', .15], ['cypress-medium', .2], ['cypress-tall', .15], ['cypress-pair', .1], ['bush-large', .2]],
};

export const ORCHARD_LAYOUT = freeze({
  regions,
  pavingRoutes: [
    { width: 1.8, points: [[15.5, 3], [14, 2], [12, 1], [10, 1], [7, 3], [-4, 3], [-8, 2], [-11, .5]] },
    { width: 1.6, points: [[0, 3], [0, -5], [-2, -5]] },
  ],
  spawn: { x: 13, y: 1 }, entries: { courtyard: { x: 13, y: 1 } }, exit: null,
  secret: { x: -11, y: .5 },
  shrine: { x: -2, y: -5 },
  pillars: [], braziers: [],
  setDressing: dressSideZone('orchard', { regions, rows: [...rows.map(([id, kind, x, y]) => [id, kind, x * 1.4, y * 1.4]), ...extensionRows], tables, salt: 400 }),
});
