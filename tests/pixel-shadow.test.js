import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { createShadow, shadowPixels } from '../src/pixel-scene.js';

const alphaAt = ({ width, data }, x, y) => data[(y * width + x) * 4 + 3];

test('contact shadow art is a symmetric 2:1 stepped ellipse with a darker core and two hard alpha levels', () => {
  for (const [radius, width] of [[.44, 28], [.5, 32], [.34, 22], [.62, 40], [.7, 44], [.18, 12]]) {
    const art = shadowPixels(radius);
    assert.deepEqual([art.width, art.height], [width, width / 2], `${radius}u at 32 px/u`);
    const levels = new Set();
    for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
      const alpha = alphaAt(art, x, y);
      levels.add(alpha);
      assert.equal(alpha, alphaAt(art, art.width - 1 - x, y), 'mirrors with a flipped drawing');
      assert.equal(alpha, alphaAt(art, x, art.height - 1 - y), 'symmetric front to back');
      assert.deepEqual([...art.data.slice((y * art.width + x) * 4, (y * art.width + x) * 4 + 3)], [255, 255, 255]);
    }
    assert.deepEqual([...levels].sort((a, b) => a - b), [0, 160, 255]);
    assert.equal(alphaAt(art, 0, 0), 0, 'corners stay transparent');
    assert.equal(alphaAt(art, art.width / 2, Math.floor(art.height / 2)), 255, 'darkest at the feet');
    assert.equal(alphaAt(art, 0, Math.floor(art.height / 2)), 160, 'the rim reaches the full width');
    // Each row is one run: rim, core, rim. No isolated pixels or holes.
    for (let y = 0; y < art.height; y++) {
      const row = Array.from({ length: art.width }, (_, x) => alphaAt(art, x, y));
      const changes = row.slice(1).filter((alpha, x) => alpha !== row[x]).length;
      assert.ok(changes <= 4, `row ${y} has ${changes} edges`);
    }
  }
});

test('a contact shadow lies on the floor with texels on the screen grid at sprite density', t => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 450 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('shadow-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -12.5, orthoRight: 12.5, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const shadow = createShadow(scene, 'probe-shadow', .44);
  shadow.position.set(1.5, .023, -2);
  scene.render();
  const matrix = shadow.computeWorldMatrix(true);
  const project = local => Vector3.Project(Vector3.TransformCoordinates(local, matrix), Matrix.Identity(),
    scene.getTransformMatrix(), camera.viewport.toGlobal(800, 450));
  const positions = shadow.getVerticesData('position'), uvs = shadow.getVerticesData('uv');
  const corners = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const local = Vector3.FromArray(positions, i * 3);
    assert.ok(Math.abs(Vector3.TransformCoordinates(local, matrix).y - .023) < 1e-9, 'flat on the floor');
    corners.push({ screen: project(local), u: uvs[i * 2], v: uvs[i * 2 + 1] });
  }
  const at = (u, v) => corners.find(c => c.u === u && c.v === v).screen;
  const width = at(1, 0).x - at(0, 0).x, height = at(0, 0).y - at(0, 1).y;
  // 28 x 14 texels at the camera's 32 px/u: one texel per screen pixel, texture U = screen right.
  assert.ok(Math.abs(width - 28) < 1e-3 && Math.abs(height - 14) < 1e-3, `projected ${width} x ${height}`);
  assert.ok(Math.abs(at(1, 0).y - at(0, 0).y) < 1e-3 && Math.abs(at(0, 1).x - at(0, 0).x) < 1e-3, 'axis-aligned on screen');
  const centre = project(Vector3.Zero()), anchor = Vector3.Project(shadow.position, Matrix.Identity(),
    scene.getTransformMatrix(), camera.viewport.toGlobal(800, 450));
  assert.ok(Math.hypot(centre.x - anchor.x, centre.y - anchor.y) < 1e-3, 'centred on its anchor');
  const material = shadow.material;
  assert.equal(material.diffuseTexture.samplingMode, 1, 'nearest sampling');
  assert.equal(material.useAlphaFromDiffuseTexture, true);
  assert.equal(material.alpha, .46);
  assert.equal(shadow.isPickable, false);
});

test('shadows of one size share a texture, and the last one releases it', t => {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const counts = () => [scene.meshes.length, scene.materials.length, scene.textures.length];
  const baseline = counts();
  for (let round = 0; round < 3; round++) {
    const a = createShadow(scene, 'a', .5), b = createShadow(scene, 'b', .5), c = createShadow(scene, 'c', .18, { alpha: .3 });
    assert.equal(a.material.diffuseTexture, b.material.diffuseTexture);
    assert.notEqual(a.material.diffuseTexture, c.material.diffuseTexture);
    assert.notEqual(a.material, b.material, 'per-shadow opacity and disposal');
    assert.equal(c.material.alpha, .3);
    assert.equal(scene.textures.length, baseline[2] + 2);
    const shared = a.material.diffuseTexture;
    for (const mesh of [a, c]) { const material = mesh.material; mesh.dispose(); material.dispose(); }
    assert.ok(scene.textures.includes(shared), 'a remaining user keeps the texture');
    const material = b.material; b.dispose(); material.dispose();
    assert.deepEqual(counts(), baseline, `round ${round} leaks`);
  }
});
