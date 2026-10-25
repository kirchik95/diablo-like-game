import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame, startAttack, startDash, startWave } from '../src/game.js';
import { Input } from '../src/input.js';
import { monkPose, houndPose, PresentationState } from '../src/pixel-animation.js';
import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };
import { BRAZIERS, EXIT, SHRINE, clearLine, findPath, isWalkable } from '../src/world.js';

const STEP = 1 / 120;
const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };

function advance(game, seconds, input = idle) {
  for (let tick = 0; tick < Math.ceil(seconds / STEP); tick++) {
    updateGame(game, input, STEP);
  }
}

function encounter(x = 1, y = 0) {
  const game = createGame();
  Object.assign(game.player, { x: 0, y: 0 });
  Object.assign(game.enemies[0], { x, y, state: 'stunned', timer: 10 });
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius));
  assert.ok(isWalkable(x, y, game.enemies[0].radius));
  return game;
}

function inputFor(keys, player, target = null) {
  return Input.prototype.sample.call({
    keys: new Set(keys),
    pointer: target ? { x: 10, y: 20 } : null,
    renderer: { screenToWorld: () => target },
    actions: [],
    attack: false,
  }, player);
}

function walkTo(game, target) {
  const path = findPath(game.player, target, game.player.radius);
  assert.ok(path.length > 0, `no route to ${JSON.stringify(target)}`);
  for (const waypoint of [...path.slice(1), target]) {
    let tick = 0;
    while (game.phase === 'playing') {
      const dx = waypoint.x - game.player.x;
      const dy = waypoint.y - game.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance < .06) break;
      assert.ok(tick++ < 1200, `movement stuck near ${JSON.stringify(waypoint)}`);
      updateGame(game, { ...idle, moveX: dx / distance, moveY: dy / distance }, STEP);
      assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius));
    }
  }
}

const keyDirections = [
  ['KeyW'], ['KeyD'], ['KeyS'], ['KeyA'],
  ['KeyW', 'KeyD'], ['KeyD', 'KeyS'], ['KeyS', 'KeyA'], ['KeyA', 'KeyW'],
];

test('pixel slice: all eight movement headings aim a locked swing at the front target', () => {
  for (const keys of keyDirections) {
    const origin = createGame().player;
    const sampled = inputFor(keys, origin);
    const length = Math.hypot(sampled.aimX, sampled.aimY);
    const dx = sampled.aimX / length, dy = sampled.aimY / length;
    for (const side of [1, -1]) {
      const game = encounter(dx * side, dy * side);
      const enemy = game.enemies[0];
      const beforeHp = enemy.hp;
      assert.equal(startAttack(game, sampled.aimX, sampled.aimY), true);
      const initialPose = monkPose(game.player);
      advance(game, .2, { ...idle, aimX: -dx, aimY: -dy });
      assert.ok(game.player.attack?.struck, keys.join('+'));
      assert.ok(Math.abs(game.player.dx * dy - game.player.dy * dx) < 1e-8);
      assert.ok(game.player.dx * dx + game.player.dy * dy > 0);
      assert.equal(monkPose(game.player).flip, initialPose.flip);
      if (side === 1) assert.ok(enemy.hp < beforeHp, `${keys}: front target missed`);
      else assert.equal(enemy.hp, beforeHp, `${keys}: rear target was hit`);
    }
  }
});

test('pixel slice: pointer aim is independent of movement and queued actions are consumed once', () => {
  const game = encounter();
  const target = { x: game.player.x + 1, y: game.player.y };
  const controls = inputFor(['KeyW', 'KeyA'], game.player, target);
  assert.ok(controls.moveY < 0);
  assert.equal(controls.moveX, 0);
  assert.ok(controls.aimX > 0);
  assert.equal(controls.aimY, 0);
  const state = {
    keys: new Set(['KeyW']), pointer: null, actions: ['dash', 'wave'], attack: true,
  };
  assert.deepEqual(Input.prototype.sample.call(state, game.player).actions, ['dash', 'wave']);
  assert.deepEqual(Input.prototype.sample.call(state, game.player).actions, []);
  state.actions.push('dash');
  Input.prototype.clear.call(state);
  const cleared = Input.prototype.sample.call(state, game.player);
  assert.deepEqual(cleared.actions, []);
  assert.equal(cleared.attack, false);
  assert.equal(Math.hypot(cleared.moveX, cleared.moveY), 0);
});

test('pixel slice: dash follows its initial heading despite changed aim and held attack', () => {
  for (const keys of keyDirections) {
    const game = encounter();
    const sampled = inputFor(keys, game.player);
    const length = Math.hypot(sampled.moveX, sampled.moveY);
    const dx = sampled.moveX / length, dy = sampled.moveY / length;
    assert.equal(startDash(game, sampled.moveX, sampled.moveY), true);
    assert.equal(startAttack(game, -dx, -dy), false);
    assert.equal(startWave(game), false);
    const pose = monkPose(game.player);
    const clip = monkPackage.monk.clips.dash;
    const frames = clip[Math.abs(dx + dy) < 1e-9 ? 'side' : dx + dy < 0 ? 'back' : 'front'];
    const shown = new Set([pose.frame]);
    let ticks = 0;
    while (game.player.dashTime > 0) {
      assert.ok(ticks++ < 120);
      updateGame(game, { ...idle, aimX: -dx, aimY: -dy, attack: true }, STEP);
      assert.equal(game.player.attack, null);
      if (game.player.dashTime > 0) {
        const current = monkPose(game.player);
        assert.equal(current.flip, pose.flip);
        assert.ok(frames.includes(current.frame), 'dash must keep its authored facing while animating');
        shown.add(current.frame);
      }
    }
    assert.equal(shown.size, frames.length, 'all active dash keys must be observable within its unchanged duration');
    assert.ok(game.player.x * dx + game.player.y * dy > 0);
    assert.ok(Math.abs(game.player.x * dy - game.player.y * dx) < 1e-8);
    assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius));
  }
});

test('pixel slice: dash and wave cancel a pending swing without a delayed extra hit', () => {
  for (const action of ['dash', 'wave']) {
    const game = encounter();
    startAttack(game, 1, 0);
    if (action === 'dash') startDash(game, 0, 1);
    else startWave(game);
    const hpAfterAction = game.enemies[0].hp;
    assert.equal(game.player.attack, null);
    advance(game, .3);
    assert.equal(game.enemies[0].hp, hpAfterAction, action);
    assert.equal(game.player.attack, null);
  }
});

test('pixel slice: a brazier blocks both a melee hit and the spirit wave', () => {
  const brazier = BRAZIERS[0];
  const game = encounter();
  Object.assign(game.player, { x: brazier.x - .6, y: brazier.y });
  Object.assign(game.enemies[0], { x: brazier.x + .6, y: brazier.y });
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius));
  assert.ok(isWalkable(game.enemies[0].x, game.enemies[0].y, game.enemies[0].radius));
  const hp = game.enemies[0].hp;
  startAttack(game, 1, 0);
  advance(game, .2);
  assert.equal(game.enemies[0].hp, hp);
  assert.equal(startWave(game), true);
  assert.equal(game.enemies[0].hp, hp);
});

test('pixel slice: dashing into a brazier or platform edge never tunnels and allows retreat', () => {
  const brazier = BRAZIERS[0];
  const scenarios = [
    { start: { x: brazier.x + 1.1, y: brazier.y }, dx: -1, dy: 0, blocker: brazier },
    { start: { x: 0, y: 5.8 }, dx: 0, dy: 1 },
  ];
  for (const { start, dx, dy, blocker } of scenarios) {
    const game = encounter();
    Object.assign(game.player, start);
    assert.ok(isWalkable(start.x, start.y, game.player.radius));
    startDash(game, dx, dy);
    let ticks = 0;
    while (game.player.dashTime > 0) {
      assert.ok(ticks++ < 120);
      updateGame(game, idle, STEP);
      assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius));
      if (blocker) assert.ok(game.player.x > blocker.x, 'dash crossed the brazier');
    }
    const stopped = { x: game.player.x, y: game.player.y };
    advance(game, .2, { ...idle, moveX: -dx, moveY: -dy });
    const retreat = (game.player.x - stopped.x) * -dx + (game.player.y - stopped.y) * -dy;
    assert.ok(retreat > 0, 'collision trapped the player after dash');
  }
});

test('pixel slice: holding attack kills the hound once and victory needs a walked route to the exit', () => {
  const game = encounter(.8);
  const view = new PresentationState(game);
  const impactFrames = [];
  for (let tick = 0; tick < 600 && game.enemies[0].hp > 0; tick++) {
    const hp = game.enemies[0].hp;
    updateGame(game, { ...idle, attack: true }, STEP);
    view.update(game, STEP);
    if (game.enemies[0].hp < hp) {
      assert.ok(game.player.attack.struck);
      const windup = monkPose({ ...game.player, attack: { ...game.player.attack, age: 0 } });
      const impact = monkPose(game.player);
      assert.notEqual(impact.frame, windup.frame);
      impactFrames.push(impact.frame);
    }
  }
  assert.equal(game.enemies[0].hp, 0);
  assert.equal(game.kills, game.enemies.length);
  assert.equal(new Set(impactFrames).size, 3, 'the three combo contacts must use distinct authored palm strikes');
  assert.equal(game.events.filter(event => event.type === 'death').length, 1);
  advance(game, 1, { ...idle, attack: true });
  view.update(game, 1);
  const corpsePose = houndPose(game.enemies[0], undefined, view.hounds[0]);
  assert.equal(corpsePose.frame, 25, 'death must complete into the final corpse key');
  startWave(game);
  view.update(game, 1);
  assert.equal(game.events.filter(event => event.type === 'death').length, 1);
  assert.deepEqual(houndPose(game.enemies[0], undefined, view.hounds[0]), corpsePose);
  assert.equal(game.phase, 'playing');
  walkTo(game, EXIT);
  assert.equal(game.phase, 'victory');
  const finished = structuredClone(game);
  assert.equal(startAttack(game, 1, 0), false);
  assert.equal(startDash(game, 1, 0), false);
  assert.equal(startWave(game), false);
  advance(game, 1, { ...idle, moveX: 1, attack: true });
  assert.deepEqual(game, finished);
});

test('pixel slice: shrine and exit are reachable by body movement and full health does not consume healing', () => {
  const game = createGame();
  for (const enemy of game.enemies) enemy.hp = 0;
  game.kills = game.enemies.length;
  walkTo(game, SHRINE);
  assert.equal(game.shrineUsed, false);
  game.player.hp = Math.floor(game.player.maxHp / 2);
  const woundedHp = game.player.hp;
  updateGame(game, idle, STEP);
  assert.equal(game.shrineUsed, true);
  assert.ok(game.player.hp > woundedHp && game.player.hp <= game.player.maxHp);
  game.player.hp = woundedHp;
  advance(game, .2);
  assert.equal(game.player.hp, woundedHp);
  walkTo(game, EXIT);
  assert.equal(game.phase, 'victory');
});

test('pixel slice: defeat freezes state and a restart shares no mutable objects with the old run', () => {
  const game = encounter();
  game.player.hp = 1;
  Object.assign(game.enemies[0], { x: .4, state: 'leap', timer: .2, dx: -1, dy: 0, hit: false });
  updateGame(game, idle, STEP);
  assert.equal(game.phase, 'defeat');
  const defeated = structuredClone(game);
  assert.equal(startAttack(game, 1, 0), false);
  assert.equal(startDash(game, 1, 0), false);
  assert.equal(startWave(game), false);
  advance(game, 1, { ...idle, moveY: 1, attack: true });
  assert.deepEqual(game, defeated);
  const fresh = createGame();
  assert.notEqual(fresh.player, game.player);
  assert.notEqual(fresh.enemies[0], game.enemies[0]);
  assert.notEqual(fresh.effects, game.effects);
  assert.notEqual(fresh.events, game.events);
  fresh.enemies[0].path.push({ x: 1, y: 1 });
  assert.deepEqual(game, defeated);
});

test('pixel slice: a hound resumes attacking after a wave and dash end almost at its center', () => {
  const game = encounter(1.8);
  const hound = game.enemies[0];
  // Isolate recovery from overlap: the target must survive the stronger wave and damaging dash.
  Object.assign(hound, { state: 'chase', hp: 200, maxHp: 200 });
  assert.equal(startWave(game), true);
  assert.ok(hound.hp > 0, 'the overlap fixture must survive the wave');
  assert.equal(startDash(game, 1, 0), true);
  const hp = game.player.hp;
  advance(game, .2);
  assert.equal(game.player.dashTime, 0);
  assert.ok(hound.hp > 0, 'the overlap fixture must survive the dash');
  assert.ok(Math.hypot(hound.x - game.player.x, hound.y - game.player.y) < hound.radius + game.player.radius,
    'dash must end with overlapping bodies to exercise the AI regression');
  advance(game, 9.8);
  assert.ok(game.player.hp < hp, 'hound stays in chase without moving or attacking an overlapping player');
});

test('pixel slice: a hound completes a route around a brazier even after getting close to its target', () => {
  const game = createGame();
  const brazier = BRAZIERS[0];
  Object.assign(game.player, { x: brazier.x - .6, y: brazier.y, invulnerable: 100 });
  game.enemies[0].state = 'chase';
  assert.ok(isWalkable(game.player.x, game.player.y, game.enemies[0].radius));
  const path = findPath(game.enemies[0], game.player, game.enemies[0].radius);
  assert.ok(path.length > 0);
  assert.ok(path.slice(1).every((point, index) => clearLine(path[index], point, game.enemies[0].radius)));
  advance(game, 20);
  assert.ok(game.events.some(event => event.type === 'windup'), 'hound stops short of a reachable target behind a brazier');
});

test('pixel slice: the final hit flash expires while the dead hound completes then holds its corpse pose', () => {
  const game = encounter();
  const view = new PresentationState(game);
  game.enemies[0].hp = 1;
  startAttack(game, 1, 0);
  for (let tick = 0; tick < 120 && game.enemies[0].hp > 0; tick++) {
    updateGame(game, idle, STEP);
    view.update(game, STEP);
  }
  const enemy = game.enemies[0];
  assert.equal(enemy.hp, 0);
  assert.equal(houndPose(enemy, undefined, view.hounds[0]).frame, 20);
  const flashDuration = enemy.hitFlash;
  assert.ok(flashDuration > 0);
  advance(game, flashDuration * 2 + STEP);
  view.update(game, 1);
  const corpsePose = houndPose(enemy, undefined, view.hounds[0]);
  assert.equal(corpsePose.frame, 25);
  view.update(game, 1);
  assert.deepEqual(houndPose(enemy, undefined, view.hounds[0]), corpsePose);
  assert.equal(enemy.hitFlash, 0, 'death leaves the transient hit tint active permanently');
});
