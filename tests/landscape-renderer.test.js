import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3, Matrix, Ray, Plane } from '@babylonjs/core';
import { buildPixelWorld, pixelAtlases } from '../src/pixel-scene.js';
import { Renderer } from '../src/render.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable } from '../src/world.js';
import { decodeHitMask, opaqueSpritePixel } from '../src/pixel-picking.js';
import campPackage from '../assets/game/pixel-v5/camp/manifest.json' with { type: 'json' };
import naturalContacts from '../assets/concepts/camp-plan-01/source/natural-contacts.json' with { type: 'json' };
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import { readPng } from './helpers/png.js';

function harness(t) {
  const engine = new NullEngine();
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const metadata = { ...pixelAtlases,
    landscape: { cell: 160, columns: 4, rows: 2, anchor: [80, 144],
      frames: ['cypress', 'dead-tree', 'rock-large', 'rock-small', 'shrub', 'grass', 'ruin-pile', 'supplies'] },
    earth: { size: [32, 32] }, moss: { size: [32, 32] }, cliff: { size: [32, 32] },
    countryGrass: { size: [128, 128] }, countrySoil: { size: [128, 128] }, countryStone: { size: [128, 128] },
    countryDetails: { cell: 64, columns: 4, rows: 2, anchor: [32, 56],
      frames: ['grass-low', 'grass-wide', 'fern-low', 'flowers-white', 'flowers-ochre', 'leaves', 'twigs', 'pebbles-flat'] },
  };
  const assets = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, {
    ...value, texture: new Texture(null, scene, true, true, Texture.NEAREST_SAMPLINGMODE),
  }]));
  return { scene, engine, assets };
}

function groundHit(scene, x, y) {
  return scene.pickWithRay(new Ray(new Vector3(x, 10, y), new Vector3(0, -1, 0)),
    mesh => mesh.metadata?.landscapeSurface === true);
}

function groundWeights(map, x, y) {
  const column = Math.floor((x - map.origin.x) * map.pixelsPerUnit), row = Math.floor((y - map.origin.y) * map.pixelsPerUnit);
  return Array.from(map.data.subarray((row * map.width + column) * 4, (row * map.width + column) * 4 + 3), n => n / 255);
}

test('camp renders every shared placement once with its exact anchor, scale and mirror', t => {
  const { scene, assets } = harness(t), location = LOCATIONS.camp;
  const before = JSON.stringify(location), built = buildPixelWorld(scene, assets, location);
  const sprites = built.props.filter(sprite => sprite.placement);
  assert.equal(sprites.length, location.setDressing.length);
  for (const placement of location.setDressing) {
    const matches = sprites.filter(sprite => sprite.placement.id === placement.id);
    assert.equal(matches.length, 1, placement.id);
    const sprite = matches[0];
    assert.equal(sprite.mesh.position.x, placement.x);
    assert.equal(sprite.mesh.position.z, placement.y);
    assert.deepEqual(sprite.mesh.scaling.asArray(), [placement.scale, placement.scale, placement.scale]);
    assert.equal(sprite.flip, placement.flip);
    assert.equal(sprite.mesh.position.y, placement.layer === 'ground' ? .012 : .03, 'the authored camp props must be grounded at zero too');
    if (placement.layer === 'ground') assert.equal(sprite.mesh.renderingGroupId, 0, 'ground art lies under actors');
    assert.equal(sprite.atlas.frames[sprite.frame], placement.kind);
    assert.equal(sprite.mesh.isPickable, false);
    if (placement.collider && !placement.id.startsWith('boundary-')) {
      assert.ok(Math.abs(groundHit(scene, placement.collider.x, placement.collider.y).pickedPoint.y) < .001,
        `${placement.id} needs continuous ground under its collision footprint`);
    }
  }
  assert.ok(built.columns.length === 2 && built.columns.every(sprite => sprite.placement.kind === 'ruin-pillar'));
  assert.ok(sprites.some(sprite => sprite.placement.id.startsWith('boundary-')), 'the gap filler belt is rendered');
  assert.equal(built.fires.length, 1);
  const fire = built.fires[0];
  assert.equal(fire.base.atlas, assets.camp);
  assert.equal(fire.sprite.atlas, assets.campFlame);
  assert.deepEqual(fire.sprite.mesh.position.asArray(), fire.base.mesh.position.asArray());
  assert.deepEqual(fire.sprite.mesh.scaling.asArray(), fire.base.mesh.scaling.asArray());
  assert.ok(!scene.meshes.some(mesh => /^(shelter-|camp-woven-rug|rug-border|camp-brazier-|amber-flame-|bead-offering-stone)/.test(mesh.name)));
  assert.equal(JSON.stringify(location), before, 'renderer must not rewrite shared collision or placement data');
});

test('walkable shoulders render the continuous country mask and camp retains an earthen fire clearing', t => {
  const { scene, assets } = harness(t);
  for (const location of Object.values(LOCATIONS)) {
    const built = buildPixelWorld(scene, assets, location);
    const paving = new Set(location.paving.map(p => `${p.x},${p.y}`));
    const shoulders = location.tiles.filter(p => !paving.has(`${p.x},${p.y}`));
    let grass = 0;
    for (const p of shoulders) {
      const hit = groundHit(scene, p.x, p.y);
      assert.ok(hit?.hit, `missing shoulder ground at ${p.x},${p.y}`);
      const material = hit.pickedMesh.subMeshes[hit.subMeshId].getMaterial();
      assert.equal(material, built.landscape.groundMaterial, 'all submitted shoulders must use the blend mask');
      const weights = groundWeights(material.metadata.surfaceMap, p.x, p.y);
      grass += weights[0];
      if (location.id === 'camp' && location.braziers.some(f => Math.hypot(f.x - p.x, f.y - p.y) < 1.5)) {
        assert.ok(weights[1] >= .75, 'keep a worn soil clearing around the fire');
      }
    }
    assert.ok(grass / shoulders.length > (location.id === 'courtyard' ? .12 : .5), `${location.id} needs visible grass patches`);
    built.dispose();
  }
});

test('sparse batched low details leave paving, interactions, columns and encounter centers clear', t => {
  const { scene, assets } = harness(t);
  for (const location of Object.values(LOCATIONS)) {
    const built = buildPixelWorld(scene, assets, location);
    const cover = built.landscape.groundCover;
    assert.ok(cover?.length >= 5, `${location.id} needs sparse low grass on its shoulders`);
    assert.ok(cover.filter(p => p.category === 'vegetation').length < location.tiles.length * .18, 'plants must stay sparse');
    assert.ok(cover.length < location.tiles.length * .25, 'flat traces must not become a carpet');
    const reserved = [...location.portals, ...location.pillars, ...location.encounters,
      location.ritual, location.secret, location.shrine, location.reward].filter(Boolean);
    for (const p of cover) {
      assert.ok(assets.countryDetails.frames.includes(p.frame));
      assert.ok(isWalkable(p.x, p.y, .23, location), 'low grass must remain naturally walkable');
      if (p.category === 'vegetation') assert.ok(location.paving.every(tile => Math.hypot(tile.x - p.x, tile.y - p.y) >= 1.65));
      assert.ok(reserved.every(point => Math.hypot(point.x - p.x, point.y - p.y) >= 2));
    }
    assert.equal(built.landscape.details.getTotalVertices(), cover.length * 4,
      'the submitted scene must include every detail, not only its layout');
    const repeated = buildPixelWorld(scene, assets, { ...location, tiles: [...location.tiles].reverse() });
    assert.deepEqual(repeated.landscape.groundCover, cover);
    repeated.dispose(); built.dispose();
  }
});

test('every location has flat continuous zero-height ground and no vertical geometric perimeter', t => {
  const { scene, assets } = harness(t);
  for (const location of Object.values(LOCATIONS)) {
    const built = buildPixelWorld(scene, assets, location);
    for (const p of built.landscape.cells.values()) assert.equal(p.height, 0, `${location.id} still has a raised or lowered ground cell`);
    for (const mesh of built.landscape.meshes) {
      const positions = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal');
      for (let i = 1; i < positions.length; i += 3) {
        assert.equal(positions[i], 0, `${mesh.name} retains vertical perimeter geometry`);
        assert.equal(normals[i], 1, `${mesh.name} has a vertical face`);
      }
    }
    assert.ok(!scene.meshes.some(mesh => /^(cliff-|wall-)/.test(mesh.name)));
    built.dispose();
  }
});

test('camp tree and exit views show ground instead of repeated terrace faces beyond the boundary', t => {
  const { scene, assets } = harness(t);
  buildPixelWorld(scene, assets, LOCATIONS.camp);
  const camera = new ArcRotateCamera('camp-backdrop', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  // Native pixels sampled inside the reported dark triangles/strip in the
  // 1280x720 tree-occlusion and exit screenshots, using the gameplay camera.
  for (const [x, y, pixels] of [[9.2, -17.8, [[25, 146]]], [0, -27, [[70, 150], [162.5, 168]]]]) {
    camera.target.copyFrom(Renderer.prototype.cameraDestination({ player: { x, y }, world: LOCATIONS.camp }));
    camera.getViewMatrix(true); scene.updateTransformMatrix(true);
    for (const [sx, sy] of pixels) {
      const ray = Ray.CreateNew(sx, sy, 640, 360, Matrix.Identity(), camera.getViewMatrix(), camera.getProjectionMatrix());
      const hit = scene.pickWithRay(ray, mesh => mesh.metadata?.landscapeSurface === true);
      assert.ok(hit?.hit, 'the forest floor must remain filled');
      assert.ok(hit.getNormal(true).y > .99,
        `${x},${y} pixel ${sx},${sy} hits a vertical ${hit.pickedMesh.name} instead of ground`);
    }
  }
});

test('camp uses its own meadow and earth over the country surfaces, and owns all of its scenery', t => {
  const { scene, assets } = harness(t), location = LOCATIONS.camp;
  const built = buildPixelWorld(scene, assets, location);
  const ground = built.landscape.groundMaterial;
  for (const name of ['countrySoil', 'countryGrass', 'campGrass', 'campEarth', 'campBackdrop']) {
    assert.ok(ground.hasTexture(assets[name].texture), `${name} is bound to the shared ground material`);
  }
  assert.deepEqual(built.landscape.scenery, [], 'procedural groves would duplicate the authored camp country');
  const groves = location.setDressing.filter(p => p.id.startsWith('grove-'));
  assert.ok(groves.some(p => p.kind.startsWith('cypress')) && groves.some(p => p.kind.startsWith('bush')), 'the outer country stays filled');
});

test('road and courtyard boundaries are readable varied natural groups outside the unchanged walk mask', t => {
  const { scene, assets } = harness(t);
  const png = readPng(new URL('../assets/game/pixel-v4/landscape/landscape.png', import.meta.url));
  // The courtyard owns its authored belt (tests/courtyard-layout.test.js).
  for (const location of [LOCATIONS.road]) {
    const before = JSON.stringify(location), built = buildPixelWorld(scene, assets, location), border = built.landscape.border;
    assert.ok(border?.length > 20, 'an empty grass rim would hide the unchanged movement boundary');
    assert.equal(built.props.filter(p => p.borderPlacement).length, border.length, 'the actual scene must submit the border');
    const cells = new Set(location.tiles.map(p => `${p.x},${p.y}`));
    for (const p of border) assert.ok(!cells.has(`${Math.round(p.contact.x)},${Math.round(p.contact.y)}`), 'border support must stay outside the walk mask');
    assert.ok(new Set(border.map(p => p.frame)).size >= 4, 'avoid a repeated uniform fence of one sprite');
    if (location.id === 'road') {
      // The camp's stone masses, ruins and cypresses, never the old v4 art.
      // The road's ruined gate comes from the monastery ruins package.
      assert.ok(border.every(p => panorama.campPanorama.frames.includes(p.frame) || ruins.monasteryRuins.frames.includes(p.frame)));
      assert.ok(border.filter(p => /^(outcrop-|boulder-|ruin-)/.test(p.frame)).length >= 5);
      assert.ok(border.filter(p => p.frame.startsWith('cypress-')).length >= 3);
    }
    // A registered support may sit farther out than the visible top/base of a
    // wide stone. Check the actual painted contour when judging boundary gaps.
    const visibleBorder = built.props.filter(s => s.borderPlacement).flatMap(sprite => {
      const { footprint } = sprite.borderPlacement;
      // A v9 footprint is its drawn base (1.6 px contract): sample its outline.
      if (footprint) {
        const rx = footprint.radius ?? footprint.halfWidth, ry = footprint.radius ?? footprint.halfDepth;
        return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .map(([dx, dy]) => ({ x: footprint.x + dx * rx, y: footprint.y + dy * ry }));
      }
      if (!['ruin-pile', 'rock-large', 'rock-small'].includes(sprite.borderPlacement.frame)) return [sprite.borderPlacement.contact];
      const points = [], { frame, flip, mesh } = sprite;
      for (let y = 0; y < 160; y += 3) for (let x = 0; x < 160; x += 3) {
        if (!png.alpha((frame % 4) * 160 + x, Math.floor(frame / 4) * 160 + y)) continue;
        const u = ((flip ? 159.5 - x : x + .5) - 80) * mesh.scaling.x;
        const v = (y + .5 - 144) * mesh.scaling.y - mesh.position.y * 32 * Math.sin(Math.PI / 3);
        points.push({ x: mesh.position.x + (2 * v - u) / (32 * Math.SQRT2),
          y: mesh.position.z + (2 * v + u) / (32 * Math.SQRT2) });
      }
      return points;
    });
    let checked = 0;
    for (const tile of location.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (cells.has(`${tile.x + dx},${tile.y + dy}`)) continue;
      const x = tile.x + dx * .5, y = tile.y + dy * .5;
      if (location.portals.some(p => Math.hypot(p.x - x, p.y - y) < 4.5)) continue;
      // Legacy reference maps allow a half-unit of extra contour clearance
      // for spread feet. The actual OVERWORLD retains the stricter 2u check.
      assert.ok(visibleBorder.some(p => Math.hypot(p.x - x, p.y - y) < 2.5), `invisible border near ${x},${y}`);
      checked++;
    }
    assert.ok(checked > 40);
    const repeated = buildPixelWorld(scene, assets, { ...location, tiles: [...location.tiles].reverse() });
    assert.deepEqual(repeated.landscape.border, border);
    assert.equal(JSON.stringify(location), before);
    repeated.dispose(); built.dispose();
  }
});

test('procedural border and forest silhouettes leave every portal visible at all camera sizes', t => {
  const { scene, assets } = harness(t);
  assets.landscape.mask = decodeHitMask(JSON.parse(readFileSync(new URL('../assets/game/pixel-v4/landscape/hit-masks.json', import.meta.url)))['landscape.png']);
  assets.campPanorama.mask = decodeHitMask(JSON.parse(readFileSync(new URL('../assets/game/pixel-v9/camp-panorama/hit-masks.json', import.meta.url)))['camp-panorama.png']);
  assets.monasteryRuins.mask = decodeHitMask(JSON.parse(readFileSync(new URL('../assets/game/pixel-v11/monastery-ruins/hit-masks.json', import.meta.url)))['monastery-ruins.png']);
  const camera = new ArcRotateCamera('border-portals', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  for (const location of Object.values(LOCATIONS)) {
    const built = buildPixelWorld(scene, assets, location);
    for (const [width, height] of [[400, 300], [640, 360], [853, 360]]) for (const portal of location.portals) {
      Object.assign(camera, { orthoLeft: -width / 64, orthoRight: width / 64, orthoTop: height / 64, orthoBottom: -height / 64 });
      camera.target.set(portal.x, 0, portal.y);
      scene.render();
      const project = p => Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(width, height));
      for (const sprite of built.props.filter(p => p.mesh.name.startsWith('landscape-'))) {
        const origin = project(sprite.mesh.position);
        for (const [dx, dy] of [[0, 0], [.6, 0], [-.6, 0], [0, .6], [0, -.6]]) {
          const point = project(new Vector3(portal.x + dx, .04, portal.y + dy));
          assert.equal(opaqueSpritePixel(sprite, origin, point.x, point.y), false,
            `${location.id} ${sprite.mesh.name} hides portal ${portal.id}`);
        }
        // v4 country stays behind hero and combat tells; the road's v9 props
        // share the actors' depth like the camp's, and its tufts lie flat.
        const v4 = sprite.atlas === assets.landscape;
        assert.equal(sprite.mesh.renderingGroupId, v4 || sprite.mesh.billboardMode === 0 ? 0 : 1, sprite.mesh.name);
      }
    }
    built.dispose();
  }
});

test('new natural border sprites keep their measured supports on the zero-height ground after scale and mirror', t => {
  const { scene, assets } = harness(t);
  const camera = new ArcRotateCamera('border-supports', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  for (const location of [LOCATIONS.road, LOCATIONS.courtyard]) {
    const built = buildPixelWorld(scene, assets, location);
    scene.render();
    for (const sprite of built.props.filter(p => p.borderPlacement)) {
      const p = sprite.borderPlacement, { cell, anchor } = sprite.atlas;
      const contact = (panorama.footprints[p.frame] ?? ruins.footprints[p.frame])?.contactCenter
        ?? naturalContacts.frames[p.frame]?.contactCenter ?? [84.75, 127.75];
      const local = new Vector3(((p.flip ? cell - contact[0] : contact[0]) - anchor[0]) / 32, (anchor[1] - contact[1]) / 32, 0);
      const world = Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true));
      const actual = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
      const expected = Vector3.Project(new Vector3(p.contact.x, 0, p.contact.y), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
      assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1, `${p.frame}: misplaced support`);
      assert.ok(Math.abs(groundHit(scene, p.contact.x, p.contact.y).pickedPoint.y) < .001);
      assert.equal(sprite.mesh.isPickable, false);
    }
    built.dispose();
  }
});

test('portal corridors remain open into the surrounding country', t => {
  const { scene, assets } = harness(t);
  for (const [location, directions] of [[LOCATIONS.camp, [-1]], [LOCATIONS.road, [1, -1]], [LOCATIONS.courtyard, [1]]]) {
    const built = buildPixelWorld(scene, assets, location);
    const scenery = [...built.landscape.scenery, ...built.landscape.border];
    for (const [index, portal] of location.portals.entries()) {
      for (let along = -2; along <= 8; along += .5) for (const across of [-.8, 0, .8]) {
        const x = portal.x + across, y = portal.y + directions[index] * along;
        assert.ok(scenery.every(p => Math.hypot(p.contact.x - x, p.contact.y - y) > .8), `${portal.id}: obstructed exit corridor`);
        assert.ok(Math.abs(groundHit(scene, x, y).pickedPoint.y) < .001);
      }
    }
    built.dispose();
  }
});

// These rays catch the original empty camera corners, including outside the
// tile mask after a transition. They intersect the submitted mesh triangles.
for (const location of Object.values(LOCATIONS)) {
  test(`${location.id}: real terrain covers viewport corners from every reachable edge`, t => {
    const { scene, assets } = harness(t);
    buildPixelWorld(scene, assets, location);
    const camera = new ArcRotateCamera('coverage', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.minZ = .1; camera.maxZ = 100;
    const cells = new Set(location.tiles.map(p => `${p.x},${p.y}`));
    const positions = [location.spawn, ...location.portals, ...Object.values(location.entries)];
    for (const p of location.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (cells.has(`${p.x + dx},${p.y + dy}`)) continue;
      // The low camp belt can block the outer quarter-cell. Check the nearest
      // reachable approach instead of silently omitting that entire edge.
      for (const offset of [.25, 0, -.25, -.5]) {
        const edge = { x: p.x + dx * offset, y: p.y + dy * offset };
        if (isWalkable(edge.x, edge.y, .23, location)) { positions.push(edge); break; }
      }
    }
    for (const [width, height] of [[800, 600], [1024, 768], [1280, 720], [1440, 900], [1920, 1080], [2560, 1080]]) {
      const scale = Math.max(2, Math.floor(Math.min(width / 640, height / 360)));
      const nativeWidth = Math.floor(width / scale), nativeHeight = Math.floor(height / scale);
      Object.assign(camera, { orthoLeft: -nativeWidth / 64, orthoRight: nativeWidth / 64,
        orthoTop: nativeHeight / 64, orthoBottom: -nativeHeight / 64 });
      for (const p of positions) {
        const target = Renderer.prototype.cameraDestination({ player: p, world: location });
        // Upper bound for actual shake plus camera pixel rounding, both signs.
        for (const shake of [-.12, .12]) {
          camera.target.copyFrom(target.add(new Vector3(shake, 0, shake)));
          camera.getViewMatrix(true); scene.updateTransformMatrix(true);
          for (const [x, y] of [[.5, .5], [nativeWidth - .5, .5], [.5, nativeHeight - .5], [nativeWidth - .5, nativeHeight - .5]]) {
            const ray = Ray.CreateNew(x, y, nativeWidth, nativeHeight, Matrix.Identity(), camera.getViewMatrix(), camera.getProjectionMatrix());
            const hit = scene.pickWithRay(ray, mesh => mesh.metadata?.landscapeSurface === true);
            assert.ok(hit?.hit, `${width}x${height} at ${p.x},${p.y}, corner ${x},${y} exposes the clear color`);
          }
        }
      }
    }
  });
}

test('paving changes only the surface mask; both walk mask and exterior remain at zero height', t => {
  const { scene, assets } = harness(t);
  const data = { ...LOCATIONS.camp, id: 'test-landscape', pillars: [], braziers: [], portals: [], reward: null,
    tiles: [{ x: 60, y: 40 }, { x: 61, y: 40 }, { x: 60, y: 41 }], paving: [{ x: 61, y: 40 }] };
  const before = JSON.stringify(data);
  const built = buildPixelWorld(scene, assets, data);
  for (const [x, y] of [[61, 40], [60, 40], [60, 41]]) {
    const hit = groundHit(scene, x, y);
    assert.ok(hit?.hit, `no rendered ground at ${x},${y}`);
    assert.ok(Math.abs(hit.pickedPoint.y) < .001);
    assert.equal(hit.pickedMesh.subMeshes[hit.subMeshId].getMaterial(), built.landscape.groundMaterial);
  }
  assert.ok(groundWeights(built.landscape.surfaceMap, 61, 40)[1] > .75, 'paving still drives worn soil');
  for (const [x, y] of [[61, 41], [59, 40], [62, 40]]) {
    const hit = groundHit(scene, x, y);
    assert.ok(hit?.hit && Math.abs(hit.pickedPoint.y) < .001, 'the exterior must join the playable ground without a step');
  }
  assert.equal(JSON.stringify(data), before, 'scenery must not mutate collision or interactions');
});

test('landscape composition is deterministic under tile reordering and keeps tall scenery off the walk mask', t => {
  const { scene, assets } = harness(t);
  const a = buildPixelWorld(scene, assets, LOCATIONS.road);
  assert.ok(a.landscape?.scenery.length > 25, 'the space around the road needs grouped scenery');
  const country = a.props.filter(p => p.mesh.name.startsWith('landscape-'));
  assert.ok(country.length > 25 && country.every(p => [assets.campPanorama, assets.monasteryRuins].includes(p.atlas)),
    'the road country uses the camp art and the monastery ruins');
  for (const p of country) {
    assert.equal(p.mesh.isPickable, false);
    // Standing props share the actors' depth (they fade in front of them); tufts lie on the ground.
    assert.equal(p.mesh.renderingGroupId, p.mesh.billboardMode === 0 ? 0 : 1);
  }
  const scenery = structuredClone(a.landscape.scenery);
  for (const p of scenery) {
    assert.equal(p.height, 0, 'all scenery must sit on the same ground');
    const c = p.contact;
    if (p.layer === 'ground') assert.ok(isWalkable(c.x, c.y, 0, LOCATIONS.road), 'tufts grow on the walkable meadow');
    else assert.ok(!isWalkable(c.x, c.y, 0, LOCATIONS.road), 'outer scenery must stay outside the walk mask');
  }
  a.dispose();
  const b = buildPixelWorld(scene, assets, { ...LOCATIONS.road, tiles: [...LOCATIONS.road.tiles].reverse() });
  assert.deepEqual(b.landscape.scenery, scenery);
  const surfaces = scene.meshes.filter(mesh => mesh.metadata?.landscapeSurface);
  assert.ok(surfaces.length < 12, 'terrain must be batched rather than one draw per tile');
});

test('rendered camp contacts agree with world collision after anchor, scale and mirror transforms', t => {
  const { scene, assets } = harness(t);
  const built = buildPixelWorld(scene, assets, LOCATIONS.camp);
  const camera = new ArcRotateCamera('camp-contact', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  scene.render();
  const measured = { ...campPackage.footprints.tents, ...campPackage.footprints.props };
  const sprites = built.props.filter(p => p.placement && measured[p.placement.kind]);
  assert.equal(sprites.length, 5, 'exercise both tents, the fire, the supplies and the log');
  for (const sprite of sprites) {
    const { id, kind, collider } = sprite.placement;
    const { cell, anchor } = sprite.atlas;
    const footprint = measured[kind].polygon.map(([x, y]) => {
      const local = new Vector3(((sprite.flip ? cell - x : x) - anchor[0]) / 32, (anchor[1] - y) / 32, 0);
      const world = Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true));
      const screen = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
      const ray = Ray.CreateNew(screen.x, screen.y, 640, 360, Matrix.Identity(), camera.getViewMatrix(), camera.getProjectionMatrix());
      return ray.origin.add(ray.direction.scale(ray.intersectsPlane(new Plane(0, 1, 0, 0))));
    });
    const xs = footprint.map(p => p.x), ys = footprint.map(p => p.z);
    // The .03u ground lift contributes less than one native pixel of error.
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - collider.x) < .06, `${id}: wrong contact center X`);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - collider.y) < .06, `${id}: wrong contact center Y`);
    for (const p of footprint) {
      if (collider.radius) {
        assert.ok(Math.hypot(p.x - collider.x, p.z - collider.y) <= collider.radius + .06, `${id}: contact escapes circular collision`);
      } else {
        assert.ok(Math.abs(p.x - collider.x) <= (collider.halfWidth ?? collider.halfSize) + .06, `${id}: contact escapes collision X`);
        assert.ok(Math.abs(p.z - collider.y) <= (collider.halfDepth ?? collider.halfSize) + .06, `${id}: contact escapes collision Y`);
      }
    }
    assert.ok(Math.hypot(sprite.mesh.position.x - collider.x, sprite.mesh.position.z - collider.y) > .5,
      `${id}: atlas anchor must not be centered on the collider`);
  }
});

test('landscape transitions dispose owned geometry, materials and texture clones without releasing shared art', t => {
  const { scene, assets } = harness(t);
  const resourceKinds = ['meshes', 'materials', 'multiMaterials', 'textures'];
  const baseline = resourceKinds.map(key => [...scene[key]]);
  for (const location of [LOCATIONS.camp, LOCATIONS.road, LOCATIONS.courtyard, LOCATIONS.road, LOCATIONS.camp]) {
    const built = buildPixelWorld(scene, assets, location);
    assert.ok(built.landscape, 'the lifecycle check must exercise full landscape resources');
    const meshes = scene.meshes.slice();
    built.dispose(); built.dispose();
    assert.ok(meshes.every(mesh => mesh.isDisposed()));
    for (const [i, key] of resourceKinds.entries()) {
      assert.equal(scene[key].length, baseline[i].length, `${location.id} leaks ${key}`);
      assert.ok(scene[key].every((resource, index) => resource === baseline[i][index]), `${location.id} replaced a shared ${key} resource`);
    }
    for (const asset of Object.values(assets)) assert.ok(scene.textures.includes(asset.texture));
  }
});
