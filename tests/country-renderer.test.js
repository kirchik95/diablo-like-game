import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, ArcRotateCamera, Vector3, VertexBuffer } from '@babylonjs/core';
import { layoutLandscape } from '../src/landscape.js';
import { buildPixelWorld, pixelAtlases, createSprite, setSpriteFrame, disposeSprite } from '../src/pixel-scene.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable } from '../src/world.js';

const frames = ['grass-low', 'grass-wide', 'fern-low', 'flowers-white', 'flowers-ochre', 'leaves', 'twigs', 'pebbles-flat'];

function weights(map, x, y) {
  const column = Math.floor((x - map.origin.x) * map.pixelsPerUnit);
  const row = Math.floor((y - map.origin.y) * map.pixelsPerUnit);
  const offset = (row * map.width + column) * 4;
  return Array.from(map.data.subarray(offset, offset + 3), n => n / 255);
}

function harness(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const metadata = { ...pixelAtlases,
    countryGrass: { size: [128, 128] }, countrySoil: { size: [128, 128] }, countryStone: { size: [128, 128] },
    countryDetails: { cell: 64, columns: 4, rows: 2, anchor: [32, 56], frames },
  };
  const assets = Object.fromEntries(Object.entries(metadata).map(([name, atlas]) => [name,
    { ...atlas, texture: new Texture(null, scene, true, true, Texture.NEAREST_SAMPLINGMODE) }]));
  return { scene, assets };
}

for (const location of Object.values(LOCATIONS)) {
  test(`${location.id}: organic surfaces cross inside tiles, stay coherent and preserve world data`, () => {
    const before = JSON.stringify(location), layout = layoutLandscape(location), map = layout.surfaceMap;
    assert.ok(map, 'the renderer needs a world-coordinate blend mask, not per-tile materials');
    assert.equal(map.data.length, map.width * map.height * 4);
    assert.ok(map.pixelsPerUnit >= 8 && map.pixelsPerUnit <= 16);
    for (let i = 0; i < map.data.length; i += 4) {
      assert.equal(map.data[i] + map.data[i + 1] + map.data[i + 2], 255, 'every rendered mask pixel needs normalized coverage');
      // Alpha selects the camp meadow/earth: the camp and the flagstone courtyard's surroundings.
      assert.equal(map.data[i + 3], location.id === 'camp' || (location.id === 'courtyard' && location.flagstones) ? 255 : 0);
    }
    const sums = [0, 0, 0];
    let changedTiles = 0, changes = 0, alignedChanges = 0;
    const paving = new Set(location.paving.map(p => `${p.x},${p.y}`));
    const shoulders = location.tiles.filter(p => !paving.has(`${p.x},${p.y}`));
    for (const p of shoulders) {
      weights(map, p.x, p.y).forEach((weight, i) => { sums[i] += weight; });
      let changed = false;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let previous;
        for (let i = -4; i <= 4; i++) {
          const sample = weights(map, p.x + dx * (i + .5) / 8, p.y + dy * (i + .5) / 8);
          assert.ok(Math.abs(sample.reduce((sum, n) => sum + n, 0) - 1) < 1e-6, 'weights must sum to opaque coverage');
          const dominant = sample.indexOf(Math.max(...sample));
          if (previous !== undefined && previous !== dominant) {
            changes++;
            if (i === 4) alignedChanges++;
            else changed = true;
          }
          previous = dominant;
        }
      }
      if (changed) changedTiles++;
    }
    assert.ok(changedTiles >= 8, `${location.id} still has tile-sized surface borders`);
    assert.ok(alignedChanges / changes < .3, 'surface borders must not follow the gameplay grid');
    assert.ok(changedTiles / shoulders.length < .4, 'broad calm patches must remain between transitions');
    const averages = sums.map(n => n / shoulders.length);
    assert.ok(averages[0] > (location.id === 'courtyard' ? .12 : .5), 'grass must fill the shoulders');
    if (location.id === 'courtyard') {
      assert.ok(averages[2] > .25, 'the courtyard needs weathered stone remnants');
      assert.ok(averages[1] > .03, 'the courtyard needs soil between stone remnants and moss');
      // A flagstone floor covers most of the cloister; earth shows in its cracks.
      if (location.flagstones) assert.ok(averages[2] > .5, 'the cloister keeps its flagstone floor');
    }
    assert.equal(JSON.stringify(location), before);
  });

  test(`${location.id}: plants leave paths clear and every detail avoids colliders and reserved approaches`, () => {
    const layout = layoutLandscape(location), cover = layout.groundCover;
    assert.ok(cover.length >= 8 && cover.length < location.tiles.length * .25);
    const clear = [...location.portals, ...location.pillars, ...location.braziers, ...location.encounters,
      location.spawn, ...Object.values(location.entries), location.shrine, location.secret, location.ritual, location.reward].filter(Boolean);
    const clusters = new Map();
    for (const detail of cover) {
      assert.ok(frames.includes(detail.frame), `unexpected old or missing detail ${detail.frame}`);
      assert.ok(isWalkable(detail.x, detail.y, .4, location));
      const trace = ['leaves', 'twigs', 'pebbles-flat'].includes(detail.frame);
      assert.equal(detail.category, trace ? 'traces' : 'vegetation');
      if (!trace) assert.ok(location.paving.every(p => Math.hypot(detail.x - p.x, detail.y - p.y) >= 1.65));
      assert.ok(clear.every(p => Math.hypot(detail.x - p.x, detail.y - p.y) >= 2.2));
      assert.ok(detail.cluster !== undefined, 'details need stable group identity');
      const group = clusters.get(detail.cluster) ?? [];
      group.push(detail); clusters.set(detail.cluster, group);
    }
    assert.ok(new Set(cover.map(p => p.frame)).size >= 3, 'vegetation and ground litter need variety');
    for (const group of clusters.values()) {
      assert.ok(group.length >= 2, 'avoid isolated random confetti');
      for (const p of group) assert.ok(Math.hypot(p.x - group[0].x, p.y - group[0].y) < 2.5);
    }
    const repeat = layoutLandscape({ ...location, player: { x: 999, y: -999 }, tiles: [...location.tiles].reverse(), paving: [...location.paving].reverse() });
    assert.deepEqual(repeat.groundCover, cover);
    assert.deepEqual(repeat.surfaceMap, layout.surfaceMap);
    assert.deepEqual([...repeat.cells], [...layout.cells]);
  });
}

test('the continuous road center and the camp fire clearing keep worn earth', () => {
  const road = layoutLandscape(LOCATIONS.road).surfaceMap;
  assert.ok(road);
  for (let y = -16; y <= 18; y += .25) assert.ok(weights(road, 0, y)[1] > .8, `broken road center at ${y}`);
  const camp = layoutLandscape(LOCATIONS.camp).surfaceMap, fire = LOCATIONS.camp.braziers[0];
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    assert.ok(weights(camp, fire.x + dx, fire.y + dy)[1] > .8, 'the fire needs an earthen clearing');
  }
});

test('courtyard flat traces form several small groups on open stone/soil, including former paving exclusions', () => {
  const world = LOCATIONS.courtyard, layout = layoutLandscape(world);
  const traces = layout.groundCover.filter(p => p.category === 'traces');
  assert.ok(traces.length >= 16, 'the courtyard needs more than a handful of flat traces');
  const added = traces.filter(p => p.cluster.startsWith('traces:'));
  const groups = new Set(added.map(p => p.cluster));
  assert.ok(groups.size >= 4 && groups.size <= 12, 'several restrained groups, not a carpet of debris');
  assert.ok(added.some(p => world.paving.some(tile => Math.hypot(tile.x - p.x, tile.y - p.y) < 1.8)),
    'flat traces may occupy broad stone/earth that used to be excluded as paving');
  for (const p of added) assert.ok(weights(layout.surfaceMap, p.x, p.y)[0] <= .5,
    'additional flat traces belong on the open stone/earth surface');
});

test('country surfaces and low details use shared opaque/depth-tested resources and dispose without touching source art', t => {
  const { scene, assets } = harness(t);
  const camera = new ArcRotateCamera('fixed-isometric', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  const resourceKinds = ['meshes', 'materials', 'multiMaterials', 'textures'];
  const before = resourceKinds.map(kind => [...scene[kind]]);
  for (const location of Object.values(LOCATIONS)) {
    const built = buildPixelWorld(scene, assets, location), ground = built.landscape.groundMaterial;
    assert.ok(ground, 'a shared blending material must render the actual mask');
    assert.equal(ground.needAlphaBlending(), false);
    assert.equal(ground.needAlphaTesting(), false);
    const mask = ground.getActiveTextures().find(texture => texture.name === 'country-surface-mask');
    assert.ok(mask);
    assert.equal(mask.samplingMode, Texture.NEAREST_SAMPLINGMODE);
    assert.equal(mask.noMipmap, true);
    assert.equal(mask.wrapU, Texture.CLAMP_ADDRESSMODE);
    assert.equal(mask.wrapV, Texture.CLAMP_ADDRESSMODE);
    assert.equal(mask.getSize().width, built.landscape.surfaceMap.width);
    assert.equal(mask.getSize().height, built.landscape.surfaceMap.height);
    for (const name of ['countryGrass', 'countrySoil', 'countryStone']) assert.ok(ground.hasTexture(assets[name].texture));
    const batches = scene.meshes.filter(mesh => mesh.metadata?.countryDetails);
    assert.equal(batches.length, 1, 'low decoration should cost one mesh/material per location');
    const batch = batches[0], details = built.landscape.groundCover;
    assert.equal(batch.getTotalVertices(), details.length * 4);
    assert.equal(batch.getTotalIndices(), details.length * 6);
    assert.equal(batch.renderingGroupId, 0);
    assert.equal(batch.isPickable, false);
    assert.equal(batch.material.diffuseTexture, assets.countryDetails.texture);
    scene.render();
    // Compare submitted vertices against the established anchored billboard.
    const reference = createSprite(scene, 'detail-reference', assets.countryDetails);
    const local = reference.mesh.getVerticesData(VertexBuffer.PositionKind);
    const localUvs = reference.mesh.getVerticesData(VertexBuffer.UVKind);
    const actual = batch.getVerticesData(VertexBuffer.PositionKind);
    const actualUvs = batch.getVerticesData(VertexBuffer.UVKind);
    for (const [i, detail] of details.entries()) {
      reference.mesh.position.set(detail.x, detail.height + .03, detail.y);
      setSpriteFrame(reference, { frame: assets.countryDetails.frames.indexOf(detail.frame), flip: detail.flip });
      const matrix = reference.mesh.computeWorldMatrix(true);
      const expected = Array.from({ length: 4 }, (_, vertex) => Vector3.TransformCoordinates(Vector3.FromArray(local, vertex * 3), matrix));
      for (let vertex = 0; vertex < 4; vertex++) {
        const point = Vector3.FromArray(actual, (i * 4 + vertex) * 3);
        const sourceVertex = expected.findIndex(want => Vector3.Distance(point, want) < .0001);
        assert.ok(sourceVertex >= 0, 'batch changed the native billboard anchor or orientation');
        assert.ok(Math.abs(actualUvs[(i * 4 + vertex) * 2] -
          (localUvs[sourceVertex * 2] * reference.texture.uScale + reference.texture.uOffset)) < .00001,
        'batch must sample the same frame and mirror as the sprite renderer');
        assert.ok(Math.abs(actualUvs[(i * 4 + vertex) * 2 + 1] -
          (localUvs[sourceVertex * 2 + 1] * reference.texture.vScale + reference.texture.vOffset)) < .00001,
        'batch must sample the same atlas row as the sprite renderer');
      }
    }
    disposeSprite(reference);
    built.dispose(); built.dispose();
    for (const [i, kind] of resourceKinds.entries()) assert.deepEqual(scene[kind], before[i], `${location.id} leaked ${kind}`);
  }
  assert.equal(camera.isDisposed(), false);
});
