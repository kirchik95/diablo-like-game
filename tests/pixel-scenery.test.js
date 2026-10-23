import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Texture } from '@babylonjs/core';
import { buildPixelWorld } from '../src/pixel-scene.js';
import { PILLARS, SPAWN, SHRINE, EXIT, isWalkable, moveBody, findPath } from '../src/world.js';
import manifest from '../assets/game/pixel-v1/manifest.json' with { type: 'json' };
import animated from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };

test('column bases block the reachable rear-corner penetration from the render review', () => {
  for (const pillar of PILLARS) {
    // The old radius .43 allowed a radius-.23 monk at this point.
    assert.equal(isWalkable(pillar.x - .5, pillar.y - .5, .23), false);
  }
});

test('column contact follows the square plinth and the body radius around its corners', () => {
  const pillar = PILLARS[1];
  const cases = [
    { dx: -.64, dy: .64, radius: .01, walkable: false },
    { dx: -.86, dy: .86, radius: .23, walkable: false },
    { dx: -.9, dy: .9, radius: .23, walkable: true },
    { dx: -1, dy: 0, radius: .23, walkable: true },
    { dx: -.9, dy: 0, radius: .23, walkable: false },
    { dx: -1, dy: 0, radius: .29, walkable: true },
  ];
  for (const point of cases) {
    assert.equal(isWalkable(pillar.x + point.dx, pillar.y + point.dy, point.radius),
      point.walkable, JSON.stringify(point));
  }
});

test('column sprites place their measured ground-contact diamond on the collision footprint', () => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 450 });
  // Only the unrelated ritual-seal canvas needs a substitute in Node.
  engine.createCanvas = (width, height) => ({
    width, height,
    getContext: () => ({
      clearRect() {}, beginPath() {}, arc() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
    }),
  });
  const scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera('scenery-test', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    Object.assign(camera, {
      orthoLeft: -12.5, orthoRight: 12.5, orthoTop: 450 / 64, orthoBottom: -450 / 64,
    });
    const assets = {
      environment: { ...manifest.environment, texture: new Texture(null, scene) },
      world: { ...animated.world, texture: new Texture(null, scene) },
      floor: { texture: new Texture(null, scene) },
    };
    const { columns } = buildPixelWorld(scene, assets);
    scene.render();
    const project = point => Vector3.Project(point, Matrix.Identity(),
      scene.getTransformMatrix(), camera.viewport.toGlobal(800, 450));
    // Measured frame-2 base: opaque x=49..110, front y=147.
    // A one-pixel allowance gives this 64x32 ground diamond, centered at (80,132).
    const contactPoints = [
      { pixel: [80, 132], ground: [0, 0] },
      { pixel: [48, 132], ground: [Math.SQRT1_2, -Math.SQRT1_2] },
      { pixel: [112, 132], ground: [-Math.SQRT1_2, Math.SQRT1_2] },
      { pixel: [80, 116], ground: [-Math.SQRT1_2, -Math.SQRT1_2] },
      { pixel: [80, 148], ground: [Math.SQRT1_2, Math.SQRT1_2] },
    ];
    for (let i = 0; i < columns.length; i++) {
      const sprite = columns[i], pillar = PILLARS[i];
      for (const { pixel: [px, py], ground: [dx, dy] } of contactPoints) {
        const local = new Vector3((px - 80) / 32, (144 - py) / 32, 0);
        const actual = project(Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true)));
        const expected = project(new Vector3(pillar.x + dx, 0, pillar.y + dy));
        assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < .51,
          'column ' + i + ' contact pixel ' + [px, py] + ' is displaced from its collider');
      }
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('fast movement stops before a column base and can retreat', () => {
  const body = { x: 2.2, y: -2.88, radius: .23 };
  assert.ok(isWalkable(body.x, body.y, body.radius));
  moveBody(body, 3, 0);
  assert.ok(body.x < 2.9, 'movement entered the wide part of the plinth');
  assert.ok(isWalkable(body.x, body.y, body.radius));
  const stopped = body.x;
  moveBody(body, -.5, 0);
  assert.ok(body.x < stopped - .49);
});

test('column footprints preserve walked shrine and exit routes for monk and hound', () => {
  for (const radius of [.23, .29]) {
    const body = { ...SPAWN, radius };
    for (const target of [SHRINE, EXIT, SPAWN]) {
      const path = findPath(body, target, radius);
      assert.ok(path.length > 0, 'no route for radius ' + radius);
      for (const point of [...path.slice(1), target]) {
        for (let step = 0; step < 2000 && Math.hypot(point.x - body.x, point.y - body.y) > .02; step++) {
          const dx = point.x - body.x, dy = point.y - body.y, distance = Math.hypot(dx, dy);
          moveBody(body, dx / distance * Math.min(distance, .03), dy / distance * Math.min(distance, .03));
          assert.ok(isWalkable(body.x, body.y, radius));
        }
        assert.ok(Math.hypot(point.x - body.x, point.y - body.y) <= .02,
          'body stuck before ' + JSON.stringify(point) + ' with radius ' + radius);
      }
    }
  }
});
