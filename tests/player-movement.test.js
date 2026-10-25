import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, startAttack, startDash, updateGame } from '../src/game.js';
import { Input } from '../src/input.js';
import { isWalkable } from '../src/world.js';
import { LOCATIONS } from '../src/campaign.js';
import { monkPose } from '../src/pixel-animation.js';
import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`);
const idle = { moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: false };

function openGround() {
  const game = createAdventure();
  // Isolate speed from scenery, but retain the real game, movement and collision APIs.
  const tiles = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) tiles.push({ x, y });
  game.world = { ...game.world, tiles, obstacles: [] };
  Object.assign(game.player, { x: 0, y: 0 });
  return game;
}

function advance(game, input, seconds, dt) {
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) updateGame(game, { ...idle, ...input }, dt);
}

// Literal world headings for the fixed isometric Input mapping. Single keys and
// two-key chords exercise both cardinal and diagonal world movement.
const headings = [
  [['KeyW'], -Math.SQRT1_2, -Math.SQRT1_2],
  [['KeyD'], -Math.SQRT1_2, Math.SQRT1_2],
  [['KeyS'], Math.SQRT1_2, Math.SQRT1_2],
  [['KeyA'], Math.SQRT1_2, -Math.SQRT1_2],
  [['KeyW', 'KeyD'], -1, 0], [['KeyD', 'KeyS'], 0, 1],
  [['KeyS', 'KeyA'], 1, 0], [['KeyA', 'KeyW'], 0, -1],
];

for (const dt of [.01, .05]) {
  test(`one second of running covers 5.4u in all eight keyboard headings at dt=${dt}`, () => {
    for (const [keys, dx, dy] of headings) {
      const game = openGround();
      const controls = { keys: new Set(keys), pointer: null, actions: [], attack: false };
      for (let tick = 0; tick < Math.round(1 / dt); tick++) {
        updateGame(game, Input.prototype.sample.call(controls, game.player), dt);
      }
      close(game.player.x, 5.4 * dx, `${keys}: x`);
      close(game.player.y, 5.4 * dy, `${keys}: y`);
      close(Math.hypot(game.player.x, game.player.y), 5.4, `${keys}: displacement`);
      close(game.player.distance, 5.4, `${keys}: animation distance`);
      assert.equal(game.player.moving, true);
    }
  });

  test(`input magnitude is capped without amplifying partial input at dt=${dt}`, () => {
    for (const [moveX, moveY, x, y] of [[3, 4, 3.24, 4.32], [.3, .4, 1.62, 2.16], [0, 0, 0, 0]]) {
      const game = openGround();
      advance(game, { moveX, moveY }, 1, dt);
      close(game.player.x, x, 'normalized x');
      close(game.player.y, y, 'normalized y');
      close(game.player.distance, Math.hypot(x, y), 'actual travel');
    }
  });

  test(`attacking retains 65 percent movement and its own clock at dt=${dt}`, () => {
    const game = openGround();
    assert.equal(startAttack(game, 0, 1), true);
    advance(game, { moveX: 1, aimX: -1, aimY: 0 }, .2, dt);
    close(game.player.x, .702, 'travel during 200ms of attack');
    close(game.player.y, 0, 'no aim-induced displacement');
    close(game.player.distance, .702, 'attack travel accumulation');
    close(game.player.attack.age, .2, 'attack clock');
    assert.equal(game.player.attack.struck, true);
    assert.deepEqual([game.player.dx, game.player.dy], [0, 1], 'attack facing stays locked');
  });

  test(`dash retains its speed, heading and cooldown at dt=${dt}`, () => {
    const game = openGround();
    assert.equal(startDash(game, 3, 4), true);
    advance(game, { moveX: -1, moveY: -1, aimX: -1, aimY: -1, attack: true }, .15, dt);
    close(game.player.x, 1.44, 'dash x after 150ms');
    close(game.player.y, 1.92, 'dash y after 150ms');
    close(game.player.distance, 2.4, 'dash remains 16u/s');
    close(game.player.dashTime, .05, 'remaining dash time');
    close(game.player.dashCooldown, 1.05, 'remaining cooldown');
    assert.equal(game.player.attack, null);
    assert.equal(startDash(game, -1, 0), false);
  });
}

test('a delayed update still moves only one maximum simulation step', () => {
  const game = openGround();
  updateGame(game, { ...idle, moveX: 1 }, 2);
  close(game.player.x, .27, 'clamped travel');
  close(game.time, .05, 'clamped clock');
  updateGame(game, { ...idle, moveX: 1 }, 0);
  close(game.player.x, .27, 'zero dt adds no travel');
});

test('run frames follow actual faster travel without a second animation speed multiplier', () => {
  const game = openGround(), keys = [], clip = monkPackage.monk.clips.run;
  for (let tick = 0; tick < 8; tick++) {
    updateGame(game, { ...idle, moveY: 1 }, .05);
    const key = clip.front.indexOf(monkPose(game.player).frame);
    assert.ok(key >= 0, 'default pose belongs to the active run');
    const phase = clip.sourceKeys[key], nextPhase = clip.sourceKeys[key + 1] ?? clip.sourceCount;
    assert.ok(game.player.distance >= phase * .56 && game.player.distance < nextPhase * .56, 'drawn phase contains actual travel');
    keys.push(Math.floor(phase));
  }
  // .27u per tick against .56u per key: the gait follows travel, never ticks.
  assert.deepEqual(keys, [0, 0, 1, 1, 2, 2, 3, 3]);
  close(game.player.distance, 2.16, 'eight real movement steps');
  updateGame(game, idle, .05);
  assert.equal(monkPose(game.player).frame, monkPackage.monk.clips.idle.front[0]);
  close(game.player.distance, 2.16, 'standing still does not advance the gait');
});

// The south-west tent's door faces +y; run into its cloth from the doorway.
const tent = LOCATIONS.camp.setDressing.find(p => p.id === 'tent-left').collider;
const monkRadius = createAdventure().player.radius;
for (const { name, from, input, axis, contact } of [
  { name: 'campfire circle', from: [-2.2, -2.8], input: { moveX: -1 }, axis: 'x', contact: -2.5325 },
  { name: 'tent rectangle', from: [tent.x, tent.y + tent.halfDepth + 1.2], input: { moveY: -1 }, axis: 'y',
    contact: tent.y + tent.halfDepth + monkRadius },
  { name: 'outer northern walk-mask edge', from: [0, -136], input: { moveY: -1 }, axis: 'y', contact: -136.27 },
]) {
  test(`maximum-dt running stops at the ${name} and can retreat`, () => {
    const game = createAdventure();
    game.enemies = []; // Isolate physical collision from nearby courtyard combat.
    Object.assign(game.player, { x: from[0], y: from[1] });
    assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
    for (let tick = 0; tick < 30; tick++) {
      updateGame(game, { ...idle, ...input }, .05);
      assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world), `penetration at tick ${tick}`);
    }
    assert.ok(game.player[axis] >= contact && game.player[axis] < contact + .12,
      `stopped at ${game.player[axis]} instead of the physical boundary ${contact}`);
    close(game.player.distance, Math.hypot(game.player.x - from[0], game.player.y - from[1]), 'only actual movement counts');
    const stopped = { ...game.player };
    advance(game, input, .25, .05);
    assert.equal(game.player.moving, false);
    close(game.player.distance, stopped.distance, 'blocked input cannot drive the run cycle');
    updateGame(game, { ...idle, moveX: -(input.moveX ?? 0), moveY: -(input.moveY ?? 0) }, .05);
    assert.ok(game.player[axis] > stopped[axis] + .15, 'retreat remains responsive');
    assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
  });
}

test('a running monk faces travel, a standing monk faces the aim, and attacks keep their own aim', () => {
  const game = openGround(), right = { moveX: -Math.SQRT1_2, moveY: Math.SQRT1_2 };
  // D with the cursor on the left: the gait must not play backwards.
  advance(game, { ...right, aimX: 1, aimY: -1 }, .1, .01);
  close(game.player.dx, right.moveX, 'run facing x'); close(game.player.dy, right.moveY, 'run facing y');
  assert.deepEqual(monkPose(game.player), monkPose({ ...game.player, dx: right.moveX, dy: right.moveY }));
  assert.equal(monkPose(game.player).flip, false, 'screen-right travel shows the right-facing drawing');
  // A click while running strikes along the aim and holds that facing for the swing.
  updateGame(game, { ...idle, ...right, aimX: 1, aimY: -1, attack: true }, .01);
  close(game.player.attack.dx, Math.SQRT1_2, 'strike x'); close(game.player.attack.dy, -Math.SQRT1_2, 'strike y');
  advance(game, { ...right, aimX: 1, aimY: -1 }, .1, .01);
  assert.ok(game.player.attack, 'still inside the first strike');
  close(game.player.dx, Math.SQRT1_2, 'attack facing x');
  advance(game, { ...right, aimX: 1, aimY: -1 }, .2, .01);
  assert.equal(game.player.attack, null);
  close(game.player.dx, right.moveX, 'running again after the strike');
  // Standing still turns to the aim; blocked input counts as standing.
  advance(game, { aimX: 1, aimY: -1 }, .02, .01);
  close(game.player.dx, Math.SQRT1_2, 'idle aim x'); close(game.player.dy, -Math.SQRT1_2, 'idle aim y');
});
