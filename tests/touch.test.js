import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUSTER, ISO_SQUASH, TOUCH_RULES, TouchInput, attackReach, autoAimTarget, hitButton, inCancel, manualAim,
  screenState, stickMove, techniqueReach, touchLayout, worldFromScreen,
} from '../src/touch.js';
import { createAdventure } from '../src/game.js';
import { createItem } from '../src/items.js';
import { gainXp, skillParams } from '../src/run-progress.js';
import { techniqueParams } from '../src/skills.js';

const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-9, `${message} ${a} != ${b}`);
const closeVector = (actual, expected, message = '') => { close(actual[0], expected[0], message); close(actual[1], expected[1], message); };
const unit = (x, y) => { const length = Math.hypot(x, y); return [x / length, y / length]; };
// Board 01 (iPhone 14) and board 02 (Pixel 7) in CSS px, and the smallest playable screen (§2).
const IPHONE = { width: 844, height: 390, safe: { left: 47, right: 47, bottom: 21 } };
const PIXEL = { width: 915, height: 412, safe: { left: 32, bottom: 16 } };
const SMALLEST = { width: 568, height: 320 };
const U = TOUCH_RULES.u;

// A level N run: experience goes through the real level-up path, so slots and techniques follow.
function run(level = 1) {
  const game = createAdventure({}, { seed: 7 });
  const xp = [0, 80, 220, 450, 840, 1510][level - 1];
  if (xp) gainXp(game, xp);
  game.events.length = 0;
  game.enemies = [];
  Object.assign(game.player, { x: 0, y: 0, dx: 1, dy: 0 });
  return game;
}
const enemy = (id, x, y, extra = {}) => ({ id, x, y, hp: 50, maxHp: 50, kind: 'hound', state: 'chase', ...extra });
function rig({ game = run(), viewport = IPHONE, clock = () => 0, isActive = () => true } = {}) {
  const touch = new TouchInput({ getGame: () => game, clock, isActive });
  const layout = touch.resize(viewport);
  let next = 1;
  const at = slot => ({ x: layout.buttons[slot].x, y: layout.buttons[slot].y });
  const finger = (x, y) => {
    const pointerId = next++;
    return {
      pointerId, role: touch.pointerDown({ pointerId, x, y }),
      move: (mx, my) => touch.pointerMove({ pointerId, x: mx, y: my }),
      up: (ux, uy) => touch.pointerUp({ pointerId, x: ux, y: uy }),
    };
  };
  const press = slot => finger(at(slot).x, at(slot).y);
  const sample = (base) => touch.sample(game.player, base, game);
  return { touch, layout, game, finger, press, at, sample };
}

test('the layout puts the cluster, the stick and «Отмена» where boards 01 and 02 draw them', () => {
  const phone = touchLayout(IPHONE);
  const centres = Object.fromEntries(Object.entries(phone.buttons).map(([id, b]) => [id, [b.x, b.y]]));
  assert.deepEqual(centres, { lmb: [731, 297], space: [631, 333], rmb: [631, 257], q: [683, 189], f: [759, 205] });
  assert.deepEqual([phone.buttons.lmb.size, phone.buttons.lmb.zone, phone.buttons.q.size, phone.buttons.q.zone], [80, 96, 56, 64]);
  assert.deepEqual(phone.rest, { x: 147, y: 285 }, 'the resting stick: +50u from the safe left, −42u from the safe bottom');
  assert.deepEqual({ ...phone.cancel }, { left: 709, top: 92, width: 80, height: 44, pad: 4 }, '«Отмена» as on board 05');
  assert.deepEqual({ ...phone.stick }, { left: 47, right: 844 * .45, top: 96, bottom: 369 });
  const android = touchLayout(PIXEL);
  assert.deepEqual(android.rest, { x: 132, y: 312 }, 'board 02 draws the resting stick at 80, 260 with a 104 px base');
  assert.deepEqual([android.buttons.lmb.x, android.buttons.lmb.y], [849, 324]);
  assert.deepEqual(Object.keys(CLUSTER), ['lmb', 'space', 'rmb', 'q', 'f'], 'the cluster follows the SLOTS order');
});

test('touch zones keep §9: at least 44 px, 12 px between drawn buttons, no overlap, 8 px from the safe edge', () => {
  // The gap between two drawn shapes (or two zones): circles for «Удар», squares for the slots.
  const gap = (a, b, size) => {
    const ha = a[size] / 2, hb = b[size] / 2;
    if (a.round || b.round) {
      const [circle, square, r, h] = a.round ? [a, b, ha, hb] : [b, a, hb, ha];
      if (circle.round && square.round) return Math.hypot(a.x - b.x, a.y - b.y) - ha - hb;
      const nx = Math.min(Math.max(circle.x, square.x - h), square.x + h), ny = Math.min(Math.max(circle.y, square.y - h), square.y + h);
      return Math.hypot(circle.x - nx, circle.y - ny) - r;
    }
    return Math.max(Math.abs(a.x - b.x) - ha - hb, Math.abs(a.y - b.y) - ha - hb);
  };
  for (const viewport of [IPHONE, PIXEL, SMALLEST]) {
    const layout = touchLayout(viewport), buttons = Object.values(layout.buttons);
    const safe = { right: 0, bottom: 0, ...viewport.safe };
    for (const button of buttons) {
      assert.ok(button.zone >= 44, `${button.id} zone ${button.zone}`);
      assert.ok(viewport.width - safe.right - (button.x + button.size / 2) >= 8 - 1e-9, `${button.id} right edge at ${viewport.width}`);
      assert.ok(viewport.height - safe.bottom - (button.y + button.size / 2) >= 8 - 1e-9, `${button.id} bottom edge at ${viewport.height}`);
      assert.ok(button.x - button.zone / 2 > layout.stick.right, `${button.id} stays out of the stick zone`);
    }
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const [a, b] = [buttons[i], buttons[j]];
        assert.ok(gap(a, b, 'size') >= 12 - 1e-9, `${a.id}–${b.id} drawn gap ${gap(a, b, 'size')}`);
        assert.ok(gap(a, b, 'zone') > 0, `${a.id}–${b.id} zones overlap by ${-gap(a, b, 'zone')}`);
      }
    }
  }
});

test('a touch in a zone goes to its button; a gap, the world or the top band touches nothing', () => {
  const layout = touchLayout(IPHONE);
  assert.equal(hitButton(layout, 731, 297).id, 'lmb');
  assert.equal(hitButton(layout, 731 + 47, 297).id, 'lmb', 'the 48u attack zone reaches past the 40u ring');
  assert.equal(hitButton(layout, 631 - 31, 333 + 31).id, 'space', 'the 32u slot zone reaches past the 28u slot');
  assert.equal(hitButton(layout, 657, 223), null, 'between the zones of techniques 1 and 2');
  assert.equal(hitButton(layout, 420, 200), null, 'the world');
  assert.equal(inCancel(layout, 749, 114), true);
  assert.equal(inCancel(layout, 709 - 4, 92 - 4), true, 'the chip zone is the chip + 2u');
  assert.equal(inCancel(layout, 700, 114), false);
});

test('the stick: the base lands under the finger, the knob travels 20u, then the base follows', () => {
  const { touch, finger } = rig();
  const stick = finger(200, 250);
  assert.equal(stick.role, 'stick');
  assert.deepEqual(touch.stickView, { held: true, baseX: 200, baseY: 250, knobX: 0, knobY: 0 });
  stick.move(210, 250);
  assert.deepEqual(touch.stickView, { held: true, baseX: 200, baseY: 250, knobX: 10, knobY: 0 });
  stick.move(300, 250);
  assert.deepEqual(touch.stickView, { held: true, baseX: 260, baseY: 250, knobX: 20 * U, knobY: 0 }, 'the base follows past 20u');
  stick.up();
  assert.deepEqual(touch.stickView, { held: false, baseX: 147, baseY: 285, knobX: 0, knobY: 0 }, 'released: back to the 35% shadow');
  // A base that does not fit the zone moves inside it; the finger then already leans the knob.
  const edge = finger(50, 365);
  assert.equal(edge.role, 'stick');
  const view = touch.stickView, base = 26 * U;
  assert.deepEqual([view.baseX, view.baseY], [47 + base, 369 - base]);
  close(Math.hypot(view.knobX, view.knobY), 20 * U, 'the finger already leans the knob to its edge');
  edge.up();
  assert.equal(finger(30, 300).role, null, 'the safe-area inset is not the zone');
});

test('inside the 4u deadzone the monk stands; past it he walks at full speed in any direction', () => {
  const { touch, finger, sample } = rig();
  const stick = finger(200, 250);
  stick.move(200 + 4 * U, 250);
  assert.deepEqual([sample().moveX, sample().moveY], [0, 0], 'at the deadzone edge');
  stick.move(200 + 4 * U + 1, 250);
  close(Math.hypot(sample().moveX, sample().moveY), 1, 'just past it: full speed, as from the keyboard');
  for (const degrees of [0, 17, 30, 45, 100, 200, 333]) {
    const angle = degrees * Math.PI / 180;
    stick.move(200 + Math.cos(angle) * 12, 250 + Math.sin(angle) * 12);
    const { moveX, moveY } = sample();
    close(Math.hypot(moveX, moveY), 1, `${degrees}°`);
  }
  assert.deepEqual(stickMove(3, 4, 8), [0, 0]);
  stick.up();
  const { moveX, moveY } = sample();
  assert.deepEqual([moveX, moveY], [0, 0], 'released: the monk stops');
  assert.equal(touch.stick, null);
});

test('the stick turns like WASD: eight directions match the keyboard sample', async t => {
  const previous = globalThis.window, listeners = {};
  globalThis.window = { addEventListener: (type, listener) => { listeners[type] = listener; } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const { Input } = await import('../src/input.js');
  const canvas = { addEventListener() {}, focus() {} };
  const input = new Input(canvas, { screenToWorld: () => null }, () => true);
  const keyboard = (...codes) => {
    input.keys.clear();
    for (const code of codes) listeners.keydown({ code, target: canvas, repeat: false, preventDefault() {} });
    const { moveX, moveY } = input.sample({ x: 0, y: 0, dx: 0, dy: 1 });
    return unit(moveX, moveY);
  };
  const { finger, sample } = rig();
  const stick = finger(200, 250);
  const directions = [
    [[1, 0], ['KeyD']], [[-1, 0], ['KeyA']], [[0, -1], ['KeyW']], [[0, 1], ['KeyS']],
    [[1, -1], ['KeyW', 'KeyD']], [[-1, -1], ['KeyW', 'KeyA']], [[1, 1], ['KeyS', 'KeyD']], [[-1, 1], ['KeyS', 'KeyA']],
  ];
  for (const [[right, down], codes] of directions) {
    const [r, d] = unit(right, down);
    stick.move(200 + r * 30, 250 + d * 30);
    const { moveX, moveY } = sample();
    closeVector([moveX, moveY], keyboard(...codes), codes.join('+'));
    close(Math.hypot(moveX, moveY), 1, 'the game clamps a keyboard diagonal to the same full speed');
  }
});

test('one finger owns the stick; a second left finger does nothing; the stick finger may wander right', () => {
  const { touch, finger, at, sample } = rig();
  const stick = finger(200, 250);
  const second = finger(150, 300);
  assert.equal(second.role, null, 'one stick finger (§10.4)');
  const attack = at('lmb');
  stick.move(attack.x, attack.y);
  assert.equal(touch.attack, false, 'the stick finger never becomes «Удар» (§10.2)');
  assert.equal(touch.stickView.held, true);
  close(Math.hypot(sample().moveX, sample().moveY), 1);
  second.move(400, 300); second.up();
  assert.equal(touch.stickView.held, true, 'a skipped finger moves nothing');
  stick.up();
  assert.equal(finger(150, 300).role, 'stick', 'a free stick takes the next left finger');
  assert.equal(finger(420, 200).role, null, 'a touch on the world does nothing in v1 (§10)');
  assert.equal(finger(150, 40).role, null, 'above the 48u top band the left side is not the stick zone');
});

test('the right group takes two fingers: a held attack and a dash both work, a third finger does nothing', () => {
  const { touch, press, sample } = rig();
  const attack = press('lmb');
  assert.equal(attack.role, 'lmb');
  assert.equal(sample().attack, true);
  const dash = press('space');
  assert.equal(dash.role, 'space');
  let controls = sample();
  assert.deepEqual([controls.attack, controls.actions], [true, ['dash']], 'the dash fires on the touch (§6)');
  assert.equal(press('rmb').role, null, 'the third finger in the right group (§10.5)');
  assert.deepEqual(sample().actions, [], 'the skipped finger cast nothing');
  dash.up();
  assert.deepEqual([...touch.pressed], ['lmb']);
  attack.up();
  controls = sample();
  assert.equal(controls.attack, false, 'the series ends on the release');
  assert.equal(press('rmb').role, 'rmb', 'the group is free again');
});

test('clear lets every finger go; a finger kept down after it does not attack again', () => {
  const { touch, finger, press, sample } = rig();
  const attack = press('lmb');
  const stick = finger(200, 250);
  stick.move(240, 250);
  assert.equal(sample().attack, true);
  touch.clear();
  const controls = sample();
  assert.deepEqual([controls.attack, controls.moveX, controls.moveY], [false, 0, 0], 'the monk stands (§10.7)');
  attack.move(735, 300); stick.move(260, 250); attack.up(); stick.up();
  assert.equal(sample().attack, false);
  assert.equal(touch.stickView.held, false);
  assert.equal(press('lmb').role, 'lmb', 'a new touch attacks again');
  assert.equal(sample().attack, true);
});

test('a technique finger that slides off its button aims and never presses the button it crosses', () => {
  const { touch, press, at } = rig({ game: run(4) });
  const palm = press('q');
  assert.equal(palm.role, 'q');
  const crane = at('f');
  palm.move(crane.x, crane.y);
  assert.deepEqual([...touch.pressed], ['q'], '§10.3');
  assert.equal(touch.aiming.slot, 'q');
  assert.deepEqual([touch.aiming.x, touch.aiming.y], [crane.x, crane.y]);
});

test('drag aim: under 6u the release casts by rule A, from 6u it aims by the finger, over «Отмена» nothing', () => {
  const { touch, press, at, game, sample, layout } = rig({ game: run(2) });
  game.enemies = [enemy('ahead', 0, 4)];
  game.player.dx = 0; game.player.dy = 1;
  const q = at('q');
  // A short touch: the preview shows rule A, the release casts at the target.
  let palm = press('q');
  palm.move(q.x, q.y - (6 * U - 1));
  assert.equal(touch.aiming, null, 'under the threshold');
  let controls = sample();
  assert.deepEqual(controls.actions, [], 'an aimed technique waits for the release');
  assert.deepEqual([touch.preview.mode, touch.preview.skill, touch.preview.target.id], ['auto', 'palm', 'ahead']);
  palm.up();
  controls = sample();
  assert.deepEqual(controls.actions, ['slot:q']);
  assert.deepEqual(controls.aims['slot:q'], { x: 0, y: 4 });
  assert.deepEqual([controls.aimX, controls.aimY], [0, 4], 'main.js casts with aimX, aimY unchanged');
  // A drag of 6u: aim mode, the finger decides. The palm flies its full 7 units.
  palm = press('q');
  palm.move(q.x, q.y - 6 * U);
  assert.equal(touch.aiming.slot, 'q');
  sample();
  assert.equal(touch.preview.mode, 'manual');
  palm.move(q.x, q.y - 20);
  palm.up();
  controls = sample();
  assert.deepEqual(controls.actions, ['slot:q']);
  const aim = controls.aims['slot:q'];
  closeVector([aim.x, aim.y], [-7 * Math.SQRT1_2, -7 * Math.SQRT1_2], 'screen up is world (−1, −1), like W');
  // Over «Отмена»: nothing is spent; the line goes out.
  palm = press('q');
  palm.move(layout.cancel.left + 40, layout.cancel.top + 22);
  assert.equal(touch.aiming.cancel, true);
  sample();
  assert.equal(touch.preview.cancel, true);
  palm.up();
  controls = sample();
  assert.deepEqual(controls.actions, [], 'cancelled without a cost');
  assert.equal(touch.preview, null);
  // Leaving the chip again re-arms the cast.
  palm = press('q');
  palm.move(layout.cancel.left + 40, layout.cancel.top + 22);
  palm.move(q.x - 40, q.y);
  assert.equal(touch.aiming.cancel, false);
  palm.up();
  assert.deepEqual(sample().actions, ['slot:q']);
});

test('a technique on cooldown or short of spirit gets no aim mode: the touch casts and the game refuses', () => {
  const { touch, press, game, sample } = rig({ game: run(2) });
  game.player.cooldowns = { palm: .4 };
  let palm = press('q');
  assert.equal(palm.role, 'q');
  assert.deepEqual(sample().actions, ['slot:q'], 'a cast on the touch, refused like on the desktop (§6)');
  palm.move(600, 120);
  assert.equal(touch.aiming, null);
  palm.up();
  assert.deepEqual(sample().actions, []);
  game.player.cooldowns = {}; game.player.spirit = 5;
  palm = press('q');
  assert.deepEqual(sample().actions, ['slot:q']);
  palm.up();
  game.player.spirit = 60;
  assert.equal(press('f').role, 'f', 'a locked slot still owns its finger');
  assert.deepEqual(sample().actions, ['slot:f'], 'and gets the locked refusal');
});

test('techniques without an aim fire on the touch: the wave on button 1', () => {
  const { touch, press, sample, game } = rig({ game: run(1) });
  game.enemies = [enemy('near', 0, 1)];
  const wave = press('rmb');
  const controls = sample();
  assert.deepEqual(controls.actions, ['slot:rmb'], 'on the touch, not the release (§6)');
  assert.deepEqual(controls.aims['slot:rmb'], { x: 1, y: 0 }, 'F: the facing of a resting stick');
  assert.equal(touch.preview, null);
  wave.move(600, 120);
  assert.equal(touch.aiming, null, 'no aim mode');
  wave.up();
  assert.deepEqual(sample().actions, []);
});

test('manual aim reaches min to max over the 36u circle and follows the finger on the 2:1 ground', () => {
  const crane = { min: 1.5, max: 5 }, radius = TOUCH_RULES.aimRadius * U;
  close(Math.hypot(...manualAim(0, -36, crane, radius)), 3.25, 'half the circle');
  close(Math.hypot(...manualAim(0, -72, crane, radius)), 5);
  close(Math.hypot(...manualAim(0, -200, crane, radius)), 5, 'beyond the circle');
  close(Math.hypot(...manualAim(0, -1, crane, radius)), 1.5 + 3.5 / 72);
  assert.equal(manualAim(0, 0, crane, radius), null);
  // The world heading projects back onto the finger direction: right is y − x, down is (x + y) × squash.
  for (const [right, down] of [[1, -1], [3, 1], [-2, 5], [0, 1], [1, 0]]) {
    const [x, y] = worldFromScreen(right, down);
    closeVector(unit(y - x, (x + y) * ISO_SQUASH), unit(right, down), `${right}, ${down}`);
  }
  // Through TouchInput: the crane in slot 3 lands half way at half the circle.
  const { press, at, sample } = rig({ game: run(4) });
  const f = at('f'), finger = press('f');
  finger.move(f.x - 36, f.y);
  finger.up();
  const aim = sample().aims['slot:f'];
  close(Math.hypot(aim.x, aim.y), 3.25);
  closeVector(unit(aim.x, aim.y), worldFromScreen(-1, 0));
});

test('rule A: the nearest enemy in the ±60° cone, then an adjacent one, then none', () => {
  const player = { x: 0, y: 0, dx: 0, dy: 1 };
  const at = (degrees, distance) => [Math.cos(degrees * Math.PI / 180) * distance, Math.sin(degrees * Math.PI / 180) * distance];
  const pick = (enemies, forward = [1, 0], reach = 5, contact = 2.4) => autoAimTarget(player, enemies, { forward, reach, contact })?.id ?? null;
  const ahead = enemy('ahead', ...at(0, 3)), side = enemy('side', ...at(55, 3.5)), behind = enemy('behind', ...at(180, 1));
  assert.equal(pick([side, ahead, behind]), 'ahead');
  assert.equal(pick([side, behind]), 'side', 'inside 60°');
  assert.equal(pick([behind]), 'behind', 'adjacent in any direction');
  assert.equal(pick([enemy('wide', ...at(61, 3))]), null, 'outside the cone and not adjacent');
  assert.equal(pick([enemy('far', ...at(0, 5))]), null, 'at R is not closer than R');
  assert.equal(pick([]), null);
  // Two enemies less than .3 apart in distance: the one nearer the axis of F.
  assert.equal(pick([enemy('angled', ...at(40, 3)), enemy('axis', ...at(0, 3.25))]), 'axis');
  assert.equal(pick([enemy('angled', ...at(40, 3)), enemy('axis', ...at(0, 3.35))]), 'angled', 'past the tie the nearest wins');
  // Dead bodies and a sealed ritual source are not targets.
  assert.equal(pick([enemy('dead', ...at(0, 2), { hp: 0 }), enemy('sealed', ...at(0, 2), { kind: 'ritual', sealed: true })]), null);
  // F falls back to the facing when the stick rests.
  assert.equal(pick([enemy('up', 0, 3), enemy('right', 3, 0)], [0, 0]), 'up');
});

test('a held attack keeps its target while it lives within R + .6, and the corners stay .5 s after', () => {
  let now = 0;
  const game = { enemies: [], inventory: null, player: { x: 0, y: 0, dx: 1, dy: 0 } };
  const { touch, press, sample } = rig({ game, clock: () => now });
  const target = enemy('target', 2, 0), other = enemy('other', 0, 1);
  game.enemies = [target, other];
  const attack = press('lmb');
  let controls = sample();
  assert.equal(touch.attackTarget.id, 'target', 'in the cone ahead before the adjacent one behind the axis');
  assert.deepEqual([controls.aimX, controls.aimY], [2, 0]);
  target.x = 2.9;
  assert.equal((sample(), touch.attackTarget.id), 'target', 'held within R + .6 = 3.0 (§8.1.1)');
  target.x = 3.1;
  controls = sample();
  assert.equal(touch.attackTarget.id, 'other', 'out of reach: rule A again');
  assert.deepEqual([controls.aimX, controls.aimY], [0, 1]);
  other.hp = 0;
  sample();
  assert.equal(touch.attackTarget, null, 'nothing left: the strike goes along F');
  other.hp = 10;
  sample();
  assert.equal(touch.markedTarget, 'other');
  attack.up();
  now = .4; sample();
  assert.equal(touch.markedTarget, 'other', 'the corners stay .5 s after the attack');
  now = .6;
  assert.equal(touch.markedTarget, null);
});

test('the attack reach is the last strike of the series + .5; aimed techniques have their own reach', () => {
  const armed = family => ({ inventory: { equipped: { weapon: createItem({ id: `test-${family}`, family }) } } });
  close(attackReach(null), 2.4, 'bare hands: 1.9 + .5');
  close(attackReach(armed('knuckles')), 2.1);
  close(attackReach(armed('staff')), 2.9);
  assert.deepEqual(techniqueReach('palm', techniqueParams('palm')), { min: 7, max: 7 });
  assert.deepEqual(techniqueReach('crane', techniqueParams('crane')), { min: 1.5, max: 5 });
  assert.deepEqual(techniqueReach('crane', techniqueParams('crane', 'lightCrane')), { min: 1.5, max: 6.5 });
  assert.deepEqual(techniqueReach('bell', techniqueParams('bell')), { min: 0, max: 6 });
  for (const id of ['wave', 'deflect', 'mantra', 'sevenStrikes', 'dash', 'combo']) assert.equal(techniqueReach(id, techniqueParams(id)), null, id);
  // Without a target the cast goes along F at 4 units, within the technique's reach.
  const { press, sample, game } = rig({ game: run(4) });
  game.player.dx = 0; game.player.dy = -1;
  press('f').up();
  assert.deepEqual(sample().aims['slot:f'], { x: 0, y: -4 });
  assert.equal(skillParams(game, 'crane').range, 5);
});

test('portrait shows «Поверни телефон»; below 568×320 «Экран слишком мал»', () => {
  assert.equal(screenState({ width: 390, height: 844 }), 'rotate');
  assert.equal(screenState({ width: 400, height: 400 }), 'rotate', 'square counts as portrait, like the CSS feature');
  assert.equal(screenState({ width: 844, height: 390 }), 'play');
  assert.equal(screenState({ width: 568, height: 320 }), 'play');
  assert.equal(screenState({ width: 567, height: 320 }), 'small');
  assert.equal(screenState({ width: 667, height: 319 }), 'small');
});

test('the keyboard sample passes through until a finger touches, and comes back when the keyboard moves', () => {
  const { touch, finger, sample } = rig();
  const keyboard = { moveX: 0, moveY: 0, aimX: .3, aimY: .4, attack: false, actions: ['interact'] };
  assert.equal(sample(keyboard), keyboard, 'no touch yet');
  const stick = finger(200, 250);
  stick.move(240, 250);
  let controls = sample(keyboard);
  assert.deepEqual(controls.actions, ['interact']);
  assert.notEqual(controls.moveX, 0);
  stick.up();
  touch.tap('panel:next');
  assert.deepEqual(sample(keyboard).actions, ['interact', 'panel:next'], '«Монах» queues its action');
  const walking = { ...keyboard, moveX: 1, actions: [] };
  assert.equal(sample(walking), walking, 'the keyboard moved: it owns the sample again');
  assert.equal(touch.device, 'keyboard');
});

test('an inactive game takes no new fingers, and clear drops a held technique without a cost', () => {
  let active = false;
  const { touch, press, sample } = rig({ game: run(2), isActive: () => active });
  assert.equal(press('q').role, null);
  active = true;
  const palm = press('q');
  sample();
  assert.equal(touch.preview.skill, 'palm');
  touch.clear();
  palm.up();
  assert.deepEqual(sample().actions, []);
  assert.equal(touch.preview, null);
});
