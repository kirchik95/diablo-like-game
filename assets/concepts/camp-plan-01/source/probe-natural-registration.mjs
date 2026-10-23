// Real sprite projection + movement, with an in-memory pre-R1 registration.
// Writes only this concept package. Runtime art and production data stay intact.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { loadPixelAssets, buildPixelWorld } from '../../../../src/pixel-scene.js';
import { LOCATIONS } from '../../../../src/campaign.js';
import { moveBody, isWalkable } from '../../../../src/world.js';
import { readPng } from '../../../../tests/helpers/png.js';

const here = new URL('./', import.meta.url), repo = new URL('../../../../', here);
const read = path => readFileSync(new URL(path, repo));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const measured = JSON.parse(readFileSync(new URL('natural-contacts.json', here)));
const png = readPng(new URL(measured.atlas, repo));
assert.equal(sha(read(measured.atlas)), measured.atlasSha256);
const directions = [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2]];
const modes = {};
for (const mode of ['unregistered', 'registered']) {
  const data = mode === 'registered' ? LOCATIONS.camp : { ...LOCATIONS.camp,
    setDressing: LOCATIONS.camp.setDressing.map(p => measured.frames[p.kind]
      ? { ...p, x: p.collider.x, y: p.collider.y } : p) };
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  const camera = new ArcRotateCamera('contact-probe', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 5.625, orthoBottom: -5.625 });
  const fetch = globalThis.fetch;
  let assets;
  try {
    globalThis.fetch = async url => new Response(readFileSync(new URL(url)));
    assets = loadPixelAssets(scene);
    await assets.ready;
  } finally { globalThis.fetch = fetch; }
  const rendered = buildPixelWorld(scene, assets, data);
  scene.render();
  const project = p => Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
  const records = [];
  for (const sprite of rendered.props.filter(s => measured.frames[s.placement?.kind])) {
    const p = sprite.placement, c = p.collider, ground = sprite.mesh.position.y - .03;
    const pixel = (x, y) => project(Vector3.TransformCoordinates(new Vector3(
      ((sprite.flip ? 160 - x : x) - 80) / 32, (144 - y) / 32, 0), sprite.mesh.computeWorldMatrix(true)));
    const contact = pixel(...measured.frames[p.kind].contactCenter);
    const center = project(new Vector3(c.x, ground, c.y));
    const pixels = [];
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
      if (png.alpha(sprite.frame % 4 * 160 + x, Math.floor(sprite.frame / 4) * 160 + y)) pixels.push(pixel(x + .5, y + .5));
    }
    const floor = { obstacles: [c], tiles: [] };
    for (let x = Math.floor(c.x) - 5; x <= Math.ceil(c.x) + 5; x++) {
      for (let y = Math.floor(c.y) - 5; y <= Math.ceil(c.y) + 5; y++) floor.tiles.push({ x, y });
    }
    const walk = (world, dx, dy) => {
      const body = { x: c.x + 3 * dx, y: c.y + 3 * dy, radius: .23 };
      assert.ok(isWalkable(body.x, body.y, body.radius, world));
      for (let i = 0; i < 300; i++) moveBody(body, -.01 * dx, -.01 * dy, world);
      return body;
    };
    const gaps = directions.map(([dx, dy]) => {
      const body = walk(floor, dx, dy);
      const near = project(new Vector3(body.x - body.radius * dx, ground, body.y - body.radius * dy));
      return Math.min(...pixels.map(q => Math.hypot(q.x - near.x, q.y - near.y)));
    });
    const record = { id: p.id, kind: p.kind, scale: p.scale, flip: p.flip, anchor: [p.x, p.y], collider: c,
      supportHeight: ground, colliderCellHeight: rendered.landscape.cells.get(`${Math.round(c.x)},${Math.round(c.y)}`)?.height ?? 0,
      contactProjectionError: [contact.x - center.x, contact.y - center.y], isolatedActorEdgeGapFrontLeftRight: gaps };
    if (['rock-1', 'rock-2', 'shrub-1', 'cypress-1', 'dead-tree-1'].includes(p.id)) {
      const body = walk(data, ...directions[0]), foot = project(new Vector3(body.x, 0, body.y));
      record.fullCamp = { stoppedBody: body, colliderDistance: Math.hypot(body.x - c.x, body.y - c.y),
        anchorDistance: Math.hypot(body.x - p.x, body.y - p.y), footGapBelowAllOpaque: foot.y - Math.max(...pixels.map(q => q.y)),
        actorRadiusScreenY: body.radius * 16 };
    }
    records.push(record);
  }
  assert.equal(records.length, 183);
  modes[mode] = records;
  rendered.dispose(); scene.dispose(); engine.dispose();
}
const result = { units: 'native pixels at 32 px/world unit unless named height/distance/anchor/collider',
  method: 'Actual buildPixelWorld mesh transforms and PNG alpha; real moveBody. Old registration reconstructed in memory only. Isolated routes expose each collider even when a neighboring obstacle/walk mask would stop an actual camp approach first.',
  lift: '.03 world units = .831384 native pixels; support center is compared at actual sprite ground height.',
  references: Object.fromEntries(['src/camp-layout.js', 'src/pixel-scene.js', 'src/landscape.js', measured.atlas].map(p => [p, sha(read(p))])),
  geometry: Object.fromEntries(['obstacles', 'tiles', 'paving'].map(p => [p, sha(JSON.stringify(LOCATIONS.camp[p]))])), modes };
writeFileSync(new URL('natural-registration-check.json', here), JSON.stringify(result, null, 2) + '\n');
const after = modes.registered;
console.log(JSON.stringify({ props: after.length, boundary: after.filter(p => p.id.startsWith('boundary-')).length,
  maxHorizontalContactError: Math.max(...after.map(p => Math.abs(p.contactProjectionError[0]))),
  maxVerticalContactErrorIncludingLift: Math.max(...after.map(p => Math.abs(p.contactProjectionError[1]))),
  maximumActorEdgeGapByKind: Object.fromEntries(Object.keys(measured.frames).map(k => [k, Math.max(...after.filter(p => p.kind === k).flatMap(p => p.isolatedActorEdgeGapFrontLeftRight))])),
  supportCellHeightDifferences: after.filter(p => Math.abs(p.supportHeight - p.colliderCellHeight) > .001).map(p => p.id),
  reportedPaths: after.filter(p => p.fullCamp).map(p => ({ id: p.id, before: modes.unregistered.find(q => q.id === p.id).fullCamp.footGapBelowAllOpaque, after: p.fullCamp.footGapBelowAllOpaque })) }, null, 2));
