import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { buildPixelWorld, pixelAtlases } from '../src/pixel-scene.js';
import { decodeHitMask, opaqueSpritePixel } from '../src/pixel-picking.js';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { isWalkable } from '../src/world.js';
import { readPng } from './helpers/png.js';

const stoneFrames = ['ruin-pile', 'rock-large', 'rock-small'];
function harness(t, world) {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene) }]));
  assets.landscape.mask = decodeHitMask(JSON.parse(readFileSync(
    new URL('../assets/game/pixel-v4/landscape/hit-masks.json', import.meta.url)))['landscape.png']);
  const built = buildPixelWorld(scene, assets, world);
  const camera = new ArcRotateCamera('border-foot-clearance', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  const stones = built.props.filter(s => stoneFrames.includes(s.borderPlacement?.frame));
  return { scene, camera, built, stones };
}

test('reported court corner (7,-96) keeps bare ground around the hero feet at every viewport', t => {
  const { scene, camera, stones } = harness(t, OVERWORLD);
  assert.ok(isWalkable(7, -96, .29, OVERWORLD));
  for (const [width, height] of [[400, 300], [640, 360], [853, 360]]) {
    Object.assign(camera, { orthoLeft: -width / 64, orthoRight: width / 64, orthoTop: height / 64, orthoBottom: -height / 64 });
    camera.target.set(7, .1, -96.7); scene.render();
    const project = p => Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(width, height));
    const feet = project(new Vector3(7, .025, -96));
    for (const stone of stones) {
      const origin = project(stone.mesh.position);
      for (let dy = -4; dy <= -1; dy++) for (let dx = -22; dx <= 27; dx++) {
        assert.equal(opaqueSpritePixel(stone, origin, feet.x + dx, feet.y + dy), false,
          `${stone.borderPlacement.frame} paints stone under the hero at ${width}x${height}`);
      }
    }
  }
});

const png = readPng(new URL('../assets/game/pixel-v4/landscape/landscape.png', import.meta.url));
const pixels = Object.fromEntries(stoneFrames.map(frame => {
  const index = pixelAtlases.landscape.frames.indexOf(frame), points = [];
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    if (png.alpha((index % 4) * 160 + x, Math.floor(index / 4) * 160 + y)) points.push([x + .5, y + .5]);
  }
  return [frame, points];
}));

for (const world of [LOCATIONS.road, LOCATIONS.courtyard, OVERWORLD]) {
  test(`${world.id}: projected opaque border stone pixels stay outside the walkable footprint on all sides`, t => {
    const { stones, built } = harness(t, world), walk = new Set(world.tiles.map(p => `${p.x},${p.y}`));
    const visibleBorder = built.landscape.border.filter(p => !stoneFrames.includes(p.frame)).map(p => p.contact);
    for (const sprite of stones) {
      const { frame } = sprite.borderPlacement;
      assert.ok(built.landscape.boundary.some(edge => Math.hypot(
        sprite.borderPlacement.contact.x - edge.x - edge.dx * .5,
        sprite.borderPlacement.contact.y - edge.y - edge.dy * .5) < 6), 'setback must stay local to the boundary');
      for (const [x, y] of pixels[frame]) {
        // Invert the fixed 32px/u camera at ground height. Include the actual
        // sprite's height, scale and flip, not its fitted contact-center radius.
        const u = ((sprite.flip ? 160 - x : x) - 80) * sprite.mesh.scaling.x;
        const v = (y - 144) * sprite.mesh.scaling.y - sprite.mesh.position.y * 32 * Math.sin(Math.PI / 3);
        const gx = sprite.mesh.position.x + (2 * v - u) / (32 * Math.SQRT2);
        const gy = sprite.mesh.position.z + (2 * v + u) / (32 * Math.SQRT2);
        if (Math.floor(x) % 3 === 0 && Math.floor(y) % 3 === 0) visibleBorder.push({ x: gx, y: gy });
        assert.equal(walk.has(`${Math.round(gx)},${Math.round(gy)}`), false,
          `${frame} projects onto accessible ground ${gx.toFixed(2)},${gy.toFixed(2)}`);
      }
    }
    if (world.zones) for (const edge of built.landscape.boundary) {
      if (getOverworldZone(edge.x, edge.y).id === 'camp') continue;
      assert.ok(visibleBorder.some(p => Math.hypot(p.x - edge.x - edge.dx * .5, p.y - edge.y - edge.dy * .5) < 2),
        `the actual region needs a visible obstacle near ${edge.x},${edge.y}`);
    }
  });
}
