import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { Input } from '../src/input.js';
import { createGame, updateGame } from '../src/game.js';
import { createSprite, setSpriteFrame } from '../src/pixel-scene.js';
import manifest from '../assets/game/pixel-v1/manifest.json' with { type: 'json' };
import masks from '../assets/game/pixel-v1/hit-masks.json' with { type: 'json' };
import { decodeHitMask } from '../src/pixel-picking.js';

// Model the real Engine's nominal scale separately from its rounded framebuffer.
class ScaledEngine extends NullEngine {
  getHardwareScalingLevel() { return 2; }
}

function harness(t, {
  width = 1600, height = 900, renderWidth = 800, renderHeight = 450,
  left = 0, top = 0, withHound = true,
} = {}) {
  const engine = new ScaledEngine({ renderWidth, renderHeight, textureSize: 512 });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('picking-camera', Math.PI / 4, Math.PI / 3, 30,
    new Vector3(0, .1, 0), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, {
    orthoTop: renderHeight / 64, orthoBottom: -renderHeight / 64,
    orthoLeft: -renderWidth / 64, orthoRight: renderWidth / 64,
    minZ: .1, maxZ: 100,
  });
  const game = createGame();
  Object.assign(game.player, { x: -.7, y: -.7 });
  const enemy = game.enemies[0];
  Object.assign(enemy, { x: 0, y: 0, state: 'idle', attackCooldown: 100 });
  const sprite = withHound ? createSprite(scene, 'picking-hound', {
    ...manifest.hound, mask: decodeHitMask(masks['hound.png']), texture: new Texture(null, scene),
  }) : null;
  if (sprite) sprite.mesh.position.set(enemy.x, .025, enemy.y);
  else game.enemies = [];
  const rect = { width, height, left, top, right: left + width, bottom: top + height };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, engine, game,
    width: renderWidth, height: renderHeight,
    hounds: sprite ? [{ sprite }] : [],
    canvas: {
      width: renderWidth, height: renderHeight, clientWidth: width, clientHeight: height,
      getBoundingClientRect: () => ({ ...rect }),
    },
  });
  scene.render();

  // Forward projection uses the actual displayed rect, not the nominal scale=2.
  function project(point) {
    const screen = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return {
      x: rect.left + screen.x * rect.width / engine.getRenderWidth(),
      y: rect.top + screen.y * rect.height / engine.getRenderHeight(),
    };
  }

  // Coordinates are display-cell pixels: flipping changes the texture, not this point.
  function pixel(x, y) {
    const world = Vector3.TransformCoordinates(new Vector3(
      (x + .5 - manifest.hound.cell / 2) / manifest.nativePixelsPerUnit,
      (manifest.hound.anchor[1] - y - .5) / manifest.nativePixelsPerUnit,
      0,
    ), sprite.mesh.computeWorldMatrix(true));
    return { world, pointer: project(world) };
  }

  const pick = pointer => renderer.screenToWorld(pointer.x, pointer.y);
  return { renderer, game, enemy, sprite, scene, camera, project, pixel, pick };
}

function assertPoint(actual, expected, message) {
  assert.ok(actual, `${message}: no world position returned`);
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-4,
    `${message}: got (${actual.x}, ${actual.y}), expected (${expected.x}, ${expected.y})`);
}

// All orthographic rays are parallel. Derive the floor intersection independently
// of screenToWorld/createPickingRay, so a coordinate-conversion bug cannot cancel out.
function floorUnder(camera, world) {
  const direction = camera.target.subtract(camera.position);
  return {
    x: world.x - world.y * direction.x / direction.y,
    y: world.z - world.y * direction.z / direction.y,
  };
}

function assertFloor(h, probe, message) {
  const expected = floorUnder(h.camera, probe.world);
  assert.ok(Math.hypot(expected.x - h.enemy.x, expected.y - h.enemy.y) > .1,
    'fixture must distinguish the floor from the enemy center');
  assertPoint(h.pick(probe.pointer), expected, message);
}

// These probes were checked against the real hound.png, independently of hit masks:
// idle (48,60) RGBA=(71,59,74,255); idle (20,65) is opaque, (75,65) transparent;
// (51,52) is opaque in idle and transparent in windup; leap (75,65) is opaque.
test('picking: the reported opaque hound pixel (48,60) targets its world center', t => {
  const h = harness(t);
  assertPoint(h.pick(h.pixel(48, 60).pointer), h.enemy, 'visible hound body');
});

test('picking: aiming at the hound body through Input lands a melee hit', t => {
  const h = harness(t);
  const controls = Input.prototype.sample.call({
    keys: new Set(), actions: [], attack: true,
    pointer: h.pixel(48, 60).pointer, renderer: h.renderer,
  }, h.game.player);
  const hp = h.enemy.hp;
  for (let tick = 0; tick < 36; tick++) updateGame(h.game, controls, 1 / 120);
  assert.ok(h.enemy.hp < hp, 'pointer on the visible body must not aim the swing behind the monk');
});

test('picking: an asymmetric opaque pixel follows horizontal sprite mirroring', t => {
  const h = harness(t, { left: 43, top: 29 });
  assertPoint(h.pick(h.pixel(20, 65).pointer), h.enemy, 'unmirrored flank');
  setSpriteFrame(h.sprite, { frame: 0, flip: true });
  assertPoint(h.pick(h.pixel(75, 65).pointer), h.enemy, 'mirrored flank');
});

test('picking: scaled billboard pixels follow the rendered silhouette and transparent padding', t => {
  const h = harness(t, { left: 43, top: 29 });
  for (const [x, y] of [[2, 2], [.5, .75], [1.5, 2]]) {
    h.sprite.mesh.scaling.set(x, y, 1);
    for (const flip of [false, true]) {
      setSpriteFrame(h.sprite, { frame: 0, flip });
      h.scene.render();
      assertPoint(h.pick(h.pixel(flip ? 75 : 20, 65).pointer), h.enemy,
        `opaque flank at scale ${x},${y}, flip ${flip}`);
      assertFloor(h, h.pixel(flip ? 20 : 75, 65), `transparent flank at scale ${x},${y}, flip ${flip}`);
      assertFloor(h, h.pixel(0, 0), 'scaled transparent padding');
    }
  }
});

test('picking: the vacated side of a mirrored hound lets the pointer reach the floor', t => {
  const h = harness(t);
  setSpriteFrame(h.sprite, { frame: 0, flip: true });
  assertFloor(h, h.pixel(20, 65), 'transparent mirrored flank');
});

test('picking: changing the current pose also changes which pixels intercept the floor', t => {
  const h = harness(t);
  const probe = h.pixel(51, 52);
  assertPoint(h.pick(probe.pointer), h.enemy, 'idle silhouette');
  h.enemy.state = 'windup';
  setSpriteFrame(h.sprite, { frame: 3, flip: false });
  assertFloor(h, probe, 'windup silhouette no longer covers the same pixel');
});

test('picking: a moved airborne hound uses its second-row pose at an odd canvas size', t => {
  const h = harness(t, {
    width: 1441, height: 901, renderWidth: 720, renderHeight: 450, left: 137.25, top: 61.5,
  });
  Object.assign(h.enemy, { x: 1.25, y: -1.5, state: 'leap' });
  h.sprite.mesh.position.set(h.enemy.x, .225, h.enemy.y);
  setSpriteFrame(h.sprite, { frame: 4, flip: false });
  h.scene.render();
  assertPoint(h.pick(h.pixel(75, 65).pointer), h.enemy, 'moved leap body');
});

test('picking: transparent atlas padding and gaps do not capture the floor', t => {
  const h = harness(t, { left: 43, top: 29 });
  for (const [x, y] of [[0, 0], [48, 10], [48, 90], [75, 65]]) {
    assertFloor(h, h.pixel(x, y), `transparent idle pixel (${x},${y})`);
  }
});

test('picking: opaque pixels of a dead hound do not capture the floor', t => {
  const h = harness(t);
  h.enemy.hp = 0;
  h.enemy.state = 'dead';
  setSpriteFrame(h.sprite, { frame: 7, flip: false });
  assertFloor(h, h.pixel(48, 60), 'corpse body');
});

for (const hidden of ['isVisible', 'visibility', 'disabled']) {
  test(`picking: a live hound hidden by ${hidden} does not capture the floor`, t => {
    const h = harness(t);
    if (hidden === 'disabled') h.sprite.mesh.setEnabled(false);
    else h.sprite.mesh[hidden] = hidden === 'isVisible' ? false : 0;
    assertFloor(h, h.pixel(48, 60), `hidden body (${hidden})`);
  });
}

for (const [width, height] of [[1440, 900], [1441, 901]]) {
  test(`picking: floor projection round-trips at ${width}x${height} with a 720x450 framebuffer and offset`, t => {
    const h = harness(t, {
      width, height, renderWidth: 720, renderHeight: 450,
      left: 137.25, top: 61.5, withHound: false,
    });
    for (const [x, y] of [[0, 0], [2, -3], [-4.2, -4.1], [-5.5, 0], [0, 5.8], [4, 3]]) {
      const pointer = h.project(new Vector3(x, 0, y));
      assertPoint(h.pick(pointer), { x, y }, `floor point (${x},${y})`);
    }
  });
}
