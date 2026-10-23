import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Plane } from '@babylonjs/core';
import { CAMP_LAYOUT } from '../../../../src/camp-layout.js';
import { LOCATIONS } from '../../../../src/campaign.js';
import { createAdventure, updateGame } from '../../../../src/game.js';
import { Input } from '../../../../src/input.js';
import { clearLine, isWalkable } from '../../../../src/world.js';

const world = LOCATIONS.camp;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const save = (name, value) => writeFileSync(new URL(name, import.meta.url), json(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const point = ([x, y]) => ({ x, y });
const definitions = [
  ['spawn-exit', [[0, 3], [0, -27]]],
  ['entry-reward-via-paving', [[0, -22], [0, 3], [2, 5], [4, 5]]],
  ['entry-reward-shortcut', [[0, -22], [0, 1], [4, 5]]],
  ['spawn-fire', [[0, 3], [0, -1], [-1, -2]]],
  ['fire-reward', [[-1, -2], [0, -1], [0, 1], [4, 5]]],
  ['spawn-tent-left', [[0, 3], [4, -1], [5, -1]]],
  ['spawn-tent-right', [[0, 3], [-1, 4], [-2, 4]]],
  ['south-north', [[0, 22], [0, -28]]],
  ['west-east', [[-18, 0], [18, 0]]],
  ['tent-left-circuit', [[2.75, -8.25], [7.25, -8.25], [7.25, -1.75], [2.75, -1.75], [2.75, -8.25]]],
  ['tent-right-and-log-circuit', [[-9.5, 1], [-1, 1], [-1, 6.5], [-9.5, 6.5], [-9.5, 1]]],
];
const keys = {
  '1,0': ['KeyS', 'KeyA'], '-1,0': ['KeyW', 'KeyD'], '0,1': ['KeyS', 'KeyD'], '0,-1': ['KeyW', 'KeyA'],
  '1,1': ['KeyS'], '-1,-1': ['KeyW'], '1,-1': ['KeyA'], '-1,1': ['KeyD'],
};
const routes = definitions.map(([id, points]) => {
  const game = createAdventure(), path = points.map(point);
  Object.assign(game.player, path[0]); // Initial state for this independent measurement.
  for (const target of path.slice(1)) {
    assert.ok(clearLine(game.player, target, game.player.radius, world), `${id}: blocked segment`);
    for (let i = 0; i < 10000; i++) {
      const dx = target.x - game.player.x, dy = target.y - game.player.y, distance = Math.hypot(dx, dy);
      if (distance < 1e-7) break;
      const sx = Math.abs(dx) < 1e-7 ? 0 : Math.sign(dx), sy = Math.abs(dy) < 1e-7 ? 0 : Math.sign(dy);
      assert.ok(!sx || !sy || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6, 'use actual keyboard directions');
      const input = Input.prototype.sample.call({ keys: new Set(keys[`${sx},${sy}`]), pointer: null, actions: [] }, game.player);
      updateGame(game, input, Math.min(1 / 120, distance / 3.5));
      assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, world));
      assert.notEqual(i, 9999, `${id}: movement stalled`);
    }
  }
  return { id, path, distanceUnits: game.player.distance, seconds: game.adventure.elapsed };
});

const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 });
const scene = new Scene(engine);
const camera = new ArcRotateCamera('layout-viewport', Math.PI / 4, Math.PI / 3, 30,
  new Vector3(world.spawn.x, .1, world.spawn.y - .7), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
camera.orthoLeft = -10; camera.orthoRight = 10;
camera.orthoTop = 5.625; camera.orthoBottom = -5.625;
camera.minZ = .1; camera.maxZ = 100;
scene.render();
const viewport = [[0, 0], [640, 0], [640, 360], [0, 360]].map(([x, y]) => {
  const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
  const distance = ray.intersectsPlane(new Plane(0, 1, 0, 0));
  assert.ok(distance !== null);
  const p = ray.origin.add(ray.direction.scale(distance));
  return { x: p.x, y: p.z };
});
const viewportArea = Math.abs(viewport.reduce((sum, p, i) => {
  const q = viewport[(i + 1) % viewport.length];
  return sum + p.x * q.y - p.y * q.x;
}, 0)) / 2;
assert.ok(Math.abs(viewportArea - 450) < .01);
scene.dispose(); engine.dispose();

const footprintBytes = readFileSync(new URL('../../../game/pixel-v5/camp/source/footprints.json', import.meta.url));
const boundary = world.setDressing.filter(p => p.id.startsWith('boundary-'));
const offsets = boundary.map(p => {
  const [x, y] = p.id.slice('boundary-'.length).split(',').map(Number);
  return Math.hypot(p.collider.x - x, p.collider.y - y);
});
const metrics = {
  layoutSha256: sha(json(CAMP_LAYOUT)), footprintSourceSha256: sha(footprintBytes),
  areaUnits2: world.tiles.length, viewportAreaUnits2: 450, viewportRatio: world.tiles.length / 450,
  nativePixelsPerUnit: 32, framebuffer: [640, 360],
  displayModes: [{ css: [1280, 720], integerScale: 2 }, { css: [1920, 1080], integerScale: 3 }],
  camera: { alpha: Math.PI / 4, beta: Math.PI / 3, radius: 30,
    target: { x: world.spawn.x, height: .1, y: world.spawn.y - .7 }, groundViewport: viewport, measuredAreaUnits2: viewportArea },
  bounds: { minX: -19.5, maxX: 21.5, minY: -29.5, maxY: 23.5 },
  pavingCells: world.paving.length, propCount: world.setDressing.length,
  boundaryPropCount: world.setDressing.filter(p => p.id.startsWith('boundary-')).length,
  boundaryVariation: { maxOffsetUnits: Math.max(...offsets), minOffsetUnits: Math.min(...offsets),
    scaleFactorRange: [.92, 1.08], method: 'Coordinate hash; outward normal plus small tangent; center stays outside walk mask; collider radius scales with image.' },
  solidPropCount: world.obstacles.length,
  usableTileCenters: [.23, .29].map(radius => ({ radius,
    count: world.tiles.filter(p => isWalkable(p.x, p.y, radius, world)).length })),
  approaches: { fire: { x: -1, y: -2 }, reward: { x: 3, y: 5 },
    tentLeft: { x: 5, y: -1 }, tentRight: { x: -2, y: 4 } },
  walking: { speedUnitsPerSecond: 3.5, radius: .23, maxDt: 1 / 120,
    method: 'Real Input.sample WASD directions → updateGame → moveBody; no dash; initial state reset per route.', routes },
  preservedLocationSha256: Object.fromEntries(['road', 'courtyard'].map(id => [id, sha(JSON.stringify(LOCATIONS[id]))])),
};
save('layout.json', CAMP_LAYOUT);
save('navigation.json', { tiles: world.tiles, paving: world.paving, portals: world.portals });
save('metrics.json', metrics);
save('footprints.json', JSON.parse(footprintBytes));
console.log(json({ area: metrics.areaUnits2, viewport: viewportArea, paving: metrics.pavingCells,
  props: metrics.propCount, solids: metrics.solidPropCount, usable: metrics.usableTileCenters,
  routes: routes.map(({ id, distanceUnits, seconds }) => ({ id, distanceUnits, seconds })) }));
