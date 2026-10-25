import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, Mesh } from '@babylonjs/core';
import { OVERWORLD } from '../src/overworld.js';
import { sideZoneAt } from '../src/side-zones.js';
import { LOCATIONS } from '../src/campaign.js';
import { CAMP_LAYOUT, horizonAt, inBackdrop } from '../src/camp-layout.js';
import { layoutLandscape } from '../src/landscape.js';
import { buildPixelWorld, pixelAtlases } from '../src/pixel-scene.js';
import { isWalkable } from '../src/world.js';
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };

function harness(t) {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene, true, true, Texture.NEAREST_SAMPLINGMODE) }]));
  return { scene, assets };
}
const screen = (x, y) => ({ u: (y - x) * Math.SQRT1_2, v: (x + y) / (2 * Math.SQRT2) });
// Every landscape viewport from 800×600 to 2560×1080, including 1919×1080 where
// the integer scale drops to 2 and the native view is widest.
const viewports = [[800, 600], [1024, 768], [1280, 720], [1440, 900], [1600, 1080], [1919, 1080], [1920, 1080], [2559, 1080], [2560, 1080]];
const halfView = ([width, height]) => {
  const scale = Math.max(2, Math.floor(Math.min(width / 640, height / 360)));
  return { u: Math.floor(width / scale) * 1.2 / 64, v: Math.floor(height / scale) * 1.2 / 64 };
};

test('only the camp area binds the mountain backdrop and its pixel-exact horizon lookup', t => {
  const { scene, assets } = harness(t);
  for (const world of [OVERWORLD, LOCATIONS.camp, LOCATIONS.road, LOCATIONS.courtyard, LOCATIONS.cemetery, LOCATIONS.orchard]) {
    const built = buildPixelWorld(scene, assets, world), material = built.landscape.groundMaterial;
    const camp = world === OVERWORLD || world.id === 'camp';
    assert.equal(material.metadata.backdrop, camp ? CAMP_LAYOUT.backdrop : null, `${world.id}`);
    if (camp) {
      assert.ok(material.hasTexture(assets.campBackdrop.texture));
      const { data, frame, range, pixelsPerUnit } = material.metadata.horizon;
      assert.deepEqual(frame, panorama.campBackdrop.screenFrame);
      for (let column = 0; column < data.length / 4; column += 7) {
        const v = range[0] + ((data[column * 4] << 8) + data[column * 4 + 1]) / 65535 * (range[1] - range[0]);
        const expected = Math.max(range[0], horizonAt(CAMP_LAYOUT.backdrop.horizon, frame.u0 + (column + .5) / pixelsPerUnit));
        assert.ok(Math.abs(v - expected) < .002, `horizon column ${column}`);
      }
    }
    built.dispose();
  }
});

// The ground shader's lookup: the clamped horizon column, and code 0 (the rim clamped to the range
// floor) shows no backdrop. With the floor read as a real horizon, the orchard's far ground showed
// the flat backdrop under a straight line (2026-10-25).
test('the shader backdrop never covers ground that the world horizon keeps as country', t => {
  const { scene, assets } = harness(t);
  const built = buildPixelWorld(scene, assets, OVERWORLD), material = built.landscape.groundMaterial;
  const { data, frame, range, pixelsPerUnit } = material.metadata.horizon, columns = data.length / 4;
  assert.match(material.shaderPath.fragmentSource, /code > \.5 && screenPosition\.y < horizon/);
  assert.match(material.shaderPath.fragmentSource, /code > \.5 && screenPosition\.y - horizon < \.0375\) lip/, 'no dark rim line along the clamped floor');
  const shaderBackdrop = (u, v) => {
    const column = Math.max(0, Math.min(columns - 1, Math.floor((u - frame.u0) * pixelsPerUnit)));
    const code = (data[column * 4] << 8) + data[column * 4 + 1];
    return code > 0 && v < range[0] + code / 65535 * (range[1] - range[0]);
  };
  const view = halfView([1919, 1080]);
  let checked = 0;
  for (const p of OVERWORLD.tiles) {
    const centre = screen(p.x, p.y);
    for (let su = -view.u; su <= view.u; su += view.u / 6) for (let sv = -view.v; sv <= view.v; sv += view.v / 4) {
      const u = centre.u + su, v = centre.v + sv;
      // The texture holds one horizon per 1/32 u: the steep rim end may differ within a column.
      const rim = Math.max(...[-.5, 0, .5].map(d => horizonAt(CAMP_LAYOUT.backdrop.horizon, u + d / pixelsPerUnit)));
      if (shaderBackdrop(u, v)) assert.ok(v < rim + .01, `u ${u.toFixed(2)}, v ${v.toFixed(2)}`);
      checked++;
    }
  }
  assert.ok(checked > 100000);
  built.dispose();
});

test('the camp keeps its own meadow and packed earth and blends into the road across the seam', () => {
  const layout = layoutLandscape(OVERWORLD), map = layout.surfaceMap;
  const alpha = (x, y) => map.data[(Math.floor((y - map.origin.y) * 8) * map.width + Math.floor((x - map.origin.x) * 8)) * 4 + 3];
  for (const p of LOCATIONS.camp.tiles.filter(p => p.y > -35)) assert.equal(alpha(p.x, p.y), 255, `${p.x},${p.y}`);
  // The road keeps the old alpha; the courtyard beyond its seam band takes the camp meadow too.
  for (const p of OVERWORLD.tiles.filter(p => p.y < -48 && p.y >= -96.5)) assert.equal(alpha(p.x, p.y), 0);
  const seam = [];
  for (let y = -48; y <= -35; y += .25) seam.push(alpha(0, y));
  assert.ok(seam.some(a => a > 0 && a < 255), 'the seam fades over several units, not one row');
  assert.ok(new Set(seam).size > 12, 'the seam weight is continuous; the shader interleaves both meadows, not four bands');
});

test('the far backdrop stays beyond the rim from every reachable view and never replaces the road country', () => {
  const backdrop = CAMP_LAYOUT.backdrop;
  // Camera centres: every usable tile, the gameplay offset and the follow lag. The side zones
  // (world-expansion §3) count in full.
  const centres = OVERWORLD.tiles.filter(p => isWalkable(p.x, p.y, .29, OVERWORLD) && (p.y > -60 || sideZoneAt(p.x, p.y)))
    .flatMap(p => [{ x: p.x, y: p.y - .7 }, { x: p.x + .9, y: p.y + .2 }, { x: p.x - .9, y: p.y - 1.6 }]);
  let visible = 0, fromRoad = 0;
  for (const view of viewports.map(halfView)) for (const c of centres) {
    const centre = screen(c.x, c.y);
    // Sample the view edges and a coarse interior grid in screen units.
    for (let su = -view.u; su <= view.u; su += view.u / 6) for (let sv = -view.v; sv <= view.v; sv += view.v / 4) {
      const u = centre.u + su, v = centre.v + sv;
      if (v >= horizonAt(backdrop.horizon, u)) continue;
      visible++;
      if (c.y < -41.5) fromRoad++;
      const q = { u: u - backdrop.parallax * (centre.u - backdrop.reference[0]), v: v - backdrop.parallax * (centre.v - backdrop.reference[1]) };
      const frame = panorama.campBackdrop.screenFrame;
      assert.ok(q.v >= frame.v0 && q.v <= frame.v0 + frame.height, `backdrop sample ${q.v.toFixed(2)} leaves the painted rows`);
    }
  }
  assert.ok(visible > 1000, 'the mountains are actually visible from the camp');
  assert.equal(fromRoad, 0, 'the backdrop belongs to the camp view; the road never looks past the rim end');
  // Road and courtyard ground and their borders remain ordinary country.
  for (const p of OVERWORLD.tiles.filter(p => p.y < -41.5)) {
    for (const [dx, dy] of [[-6, 0], [0, -6], [-4, -4]]) assert.equal(inBackdrop(backdrop, p.x + dx, p.y + dy), false, `${p.x},${p.y}`);
  }
  const layout = layoutLandscape(OVERWORLD);
  for (const p of [...layout.scenery, ...layout.border]) assert.equal(inBackdrop(backdrop, p.contact.x, p.contact.y, .3), false);
});

test('the visible rim is lined with trees, shrubs and stones without long bare cuts', () => {
  const backdrop = CAMP_LAYOUT.backdrop, standing = [];
  for (const p of CAMP_LAYOUT.setDressing) {
    if (p.layer === 'ground') continue;
    const c = p.collider ?? p.contact, s = screen(c.x, c.y), gap = s.v - horizonAt(backdrop.horizon, s.u);
    if (gap >= 0 && gap < 2.5) standing.push(s.u);
  }
  standing.sort((a, b) => a - b);
  for (let u = 3.3; u < 30; u += .5) {
    assert.ok(standing.some(s => Math.abs(s - u) < 3), `bare rim near screen u ${u}`);
  }
});

test('ground art lies flat under actors while standing props keep their billboards', t => {
  const { scene, assets } = harness(t);
  const built = buildPixelWorld(scene, assets, LOCATIONS.camp);
  const ground = built.props.filter(s => s.placement?.layer === 'ground');
  assert.ok(ground.some(s => s.placement.kind === 'woven-carpet') && ground.some(s => s.placement.kind === 'grass-tuft'));
  for (const sprite of ground) {
    assert.equal(sprite.mesh.billboardMode, Mesh.BILLBOARDMODE_NONE);
    assert.equal(sprite.mesh.renderingGroupId, 0);
    assert.ok(sprite.mesh.position.y < .02, 'contact shadows (.02u) and the reward ring stay above the rug');
    const positions = sprite.mesh.getVerticesData('position');
    for (let i = 1; i < positions.length; i += 3) assert.ok(Math.abs(positions[i]) < 1e-9, 'the quad lies in the ground plane');
  }
  for (const sprite of built.props.filter(s => s.placement && !s.placement.layer && s.placement.kind !== 'grass')) {
    assert.equal(sprite.mesh.billboardMode, Mesh.BILLBOARDMODE_ALL);
    assert.equal(sprite.mesh.renderingGroupId, 1);
  }
  built.dispose();
});
