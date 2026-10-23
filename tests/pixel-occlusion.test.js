import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { createSprite, setSpriteFrame } from '../src/pixel-scene.js';
import { obscuresSprite } from '../src/pixel-picking.js';

function atlas(cell, anchor) {
  // Frame 0 is opaque; frame 1 is transparent. The independent fixture makes
  // overlap outside the unscaled cell and frame changes unambiguous.
  const bytes = new Uint8Array(cell * cell * 2 / 8);
  bytes.fill(255, 0, cell * cell / 8);
  return { cell, anchor, columns: 1, rows: 2, mask: { width: cell, bytes } };
}

test('occlusion samples the scaled front silhouette without adding a phantom unscaled silhouette', () => {
  const front = { atlas: atlas(16, [8, 14]), frame: 0, mesh: { scaling: { x: 2, y: 2 } } };
  const back = { atlas: atlas(8, [4, 7]), frame: 0 };
  assert.equal(obscuresSprite(front, { x: 0, y: 0 }, back, { x: 14, y: -4 }), true);
  front.mesh.scaling = { x: .5, y: .5 };
  assert.equal(obscuresSprite(front, { x: 0, y: 0 }, back, { x: 8, y: 0 }), false);
});

test('occlusion samples the scaled actor at its rendered screen positions', () => {
  const front = { atlas: atlas(16, [8, 14]), frame: 0 };
  const back = { atlas: atlas(8, [4, 7]), frame: 0, mesh: { scaling: { x: 3, y: 3 } } };
  // Two of nine opaque actor samples lie inside the front cell (>15%).
  assert.equal(obscuresSprite(front, { x: 0, y: 0 }, back, { x: 15, y: 0 }), true);
  back.mesh.scaling = { x: 0, y: 0 };
  assert.equal(obscuresSprite(front, { x: 0, y: 0 }, back, { x: 0, y: 0 }), false);
});

test('renderer fades enlarged foreground props beyond the old unscaled broad phase and restores them', t => {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('scaled-occlusion', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  const prop = createSprite(scene, 'scaled-prop', { ...atlas(16, [8, 14]), texture: new Texture(null, scene) });
  const monk = createSprite(scene, 'actor', { ...atlas(8, [4, 7]), texture: new Texture(null, scene) });
  prop.mesh.scaling.set(2, 2, 2);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, width: 640, height: 360, monk, hounds: [], world: { props: [prop] },
  });
  // Invert the fixed camera's 32px/u ground projection, independently of the
  // picking helper. Negative screen Y puts the actor behind the prop.
  const moveActor = (x, y) => monk.mesh.position.set(
    (y / 16 - x / 32) * Math.SQRT1_2, 0, (y / 16 + x / 32) * Math.SQRT1_2);
  const update = () => renderer.updateOcclusion({ enemies: [] });
  moveActor(14, -4); update();
  assert.equal(prop.material.alpha, .25, 'scaled opaque foreground must reveal the actor');
  setSpriteFrame(prop, { frame: 1, flip: false }); update();
  assert.equal(prop.material.alpha, 1, 'transparent frame must not occlude');
  setSpriteFrame(prop, { frame: 0, flip: false });
  moveActor(40, -4); update();
  assert.equal(prop.material.alpha, 1, 'actor outside the scaled cell must restore opacity');
  moveActor(0, 2); update();
  assert.equal(prop.material.alpha, 1, 'a prop behind the actor must stay opaque');
});
