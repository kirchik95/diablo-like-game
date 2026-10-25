import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  BUTTON, BUTTON_ACTIONS, KEYBOARD_KEYS, PAD_GLYPHS, PAD_RULES, GamepadInput, padFamily, radialDeadzone, isoFromScreen,
  rumbleFor, controlKeys, slotKey, isGameplayAction,
} from '../src/gamepad.js';
import { SLOTS, TECHNIQUE_SLOTS } from '../src/skills.js';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message ?? ''} ${a} != ${b}`);
const XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DUALSENSE_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

// A snapshot like Chrome's: .pressed turns on at a light touch, .value carries the analog depth.
function fakePad({ id = XBOX_ID, index = 0, mapping = 'standard', axes = [0, 0, 0, 0], pressed = [], values = {}, actuator } = {}) {
  const buttons = Array.from({ length: 18 }, (_, i) => {
    const value = values[i] ?? (pressed.includes(i) ? 1 : 0);
    return { pressed: value > .12, value };
  });
  return { id, index, mapping, connected: true, timestamp: 0, axes, buttons, vibrationActuator: actuator };
}
function rig() {
  const pads = [], events = [];
  const pad = new GamepadInput({ getGamepads: () => pads, onEvent: (type, detail) => events.push([type, detail]) });
  return { pads, events, pad, set: options => { pads[0] = fakePad(options); return pad.poll(); } };
}
const player = () => ({ x: 0, y: 0, dx: 0, dy: 1 });
const keyboard = (overrides = {}) => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: false, actions: [], ...overrides });

test('menu confirm activates a focused update notice outside the main overlay', () => {
  // Run the actual menu handler without starting WebGL or the application loop.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const handler = main.match(/function padMenu\(action\) \{[\s\S]*?\n\}/)[0];
  const calls = [];
  const button = { tagName: 'BUTTON', disabled: false, click: () => calls.push('update') };
  const confirm = runInNewContext(`(${handler})`, {
    document: { activeElement: button }, overlay: { contains: () => false }, mode: 'defeat',
    $: id => id === 'version-update' ? { contains: element => element === button } : null,
    playButton: { hidden: false, disabled: false, click: () => calls.push('new-run') },
  });
  confirm('nav:ok');
  assert.deepEqual(calls, ['update'], 'A/✕ must reload, not start a new run');
});

// The real keyboard Input, driven through a fake window, so the stick is compared with WASD itself.
async function keyboardInput() {
  const listeners = {}, canvas = { addEventListener() {}, focus() {} };
  globalThis.window = { addEventListener: (type, listener) => { listeners[type] = listener; } };
  const { Input } = await import('../src/input.js');
  const input = new Input(canvas, { screenToWorld: () => null }, () => true);
  const event = code => ({ code, target: canvas, repeat: false, preventDefault() {} });
  return {
    hold: (...codes) => { input.keys.clear(); for (const code of codes) listeners.keydown(event(code)); },
    sample: () => input.sample(player()),
  };
}

test('the family comes from the pad id: Chrome, Firefox and Safari ids', () => {
  for (const id of [
    DUALSENSE_ID, '054c-0ce6-DualSense Wireless Controller', 'DualSense Wireless Controller',
    'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', '54c-5c4-Wireless Controller', 'DUALSHOCK 4 Wireless Controller',
  ]) assert.equal(padFamily(id), 'playstation', id);
  for (const id of [
    XBOX_ID, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', '045e-0b13-Xbox Wireless Controller', 'xinput',
    '45e-28e-Microsoft X-Box 360 pad', 'Xbox Wireless Controller',
  ]) assert.equal(padFamily(id), 'xbox', id);
  for (const id of ['Logitech Dual Action (STANDARD GAMEPAD Vendor: 046d Product: c216)', '057e-2009-Pro Controller', '', undefined]) {
    assert.equal(padFamily(id), 'generic', String(id));
  }
});

test('the first poll attaches the pad, reports its family and prefers the standard mapping', () => {
  const { pads, events, pad } = rig();
  assert.equal(pad.connected, false); assert.equal(pad.family, null);
  assert.deepEqual(pad.poll(), []);
  pads.push(null, fakePad({ id: 'odd pad', index: 1, mapping: '' }), fakePad({ id: DUALSENSE_ID, index: 2 }));
  pad.poll();
  assert.equal(pad.connected, true); assert.equal(pad.family, 'playstation'); assert.equal(pad.index, 2);
  assert.deepEqual(events, [['connected', { index: 2, id: DUALSENSE_ID, family: 'playstation', standard: true }]]);
  pad.poll();
  assert.equal(events.length, 1, 'a pad that stays connected is announced once');
  assert.equal(pad.keys(), KEYBOARD_KEYS, 'a pad that has not been used yet leaves the keyboard keycaps');
  pads[2] = fakePad({ id: DUALSENSE_ID, index: 2, pressed: [BUTTON.south] });
  pad.poll();
  assert.equal(pad.keys(), PAD_GLYPHS.playstation);
  assert.deepEqual([pad.keys().dash, pad.keys().attack], ['✕', 'R2']);

  const throwing = new GamepadInput({ getGamepads: () => { throw new Error('gamepad blocked by permissions policy'); } });
  assert.deepEqual(throwing.poll(), []); assert.equal(throwing.connected, false);
  const nonStandard = new GamepadInput({ getGamepads: () => [fakePad({ mapping: '' })] });
  nonStandard.poll();
  assert.equal(nonStandard.connected, true, 'a pad without the standard mapping still drives the game');
  assert.equal(nonStandard.standard, false);
});

test('radial deadzones: the left stick ignores .18, the right stick .3, and the length rescales', () => {
  assert.deepEqual(radialDeadzone(.1, .1, .18), [0, 0, 0]);
  assert.deepEqual(radialDeadzone(.18, 0, .18), [0, 0, 0]);
  assert.deepEqual(radialDeadzone(NaN, 0, .18), [0, 0, 0]);
  const [x, y, length] = radialDeadzone(0, .59, .18);
  close(x, 0); close(y, .5); close(length, .5);
  const corner = radialDeadzone(1, 1, .18);
  close(corner[2], 1, 'a square gate corner clamps to full tilt');
  close(corner[0], Math.SQRT1_2); close(corner[1], Math.SQRT1_2);

  const { set, pad } = rig();
  set({ axes: [.12, -.12, 0, 0] });
  assert.deepEqual(pad.move, [0, 0]); assert.equal(pad.active, false, 'stick drift does not take over the HUD');
  set({ axes: [0, .59, 0, 0] });
  close(Math.hypot(...pad.move), .5, 'a half tilt walks at half speed');
  set({ axes: [0, 0, .25, 0] });
  assert.equal(pad.aimStick, null);
  set({ axes: [0, 0, .4, 0] });
  close(Math.hypot(pad.aimStick.x, pad.aimStick.y), 1, 'a tilted right stick gives a unit heading');
  close(pad.aimStick.tilt, (.4 - .3) / .7, 'and keeps its rescaled tilt');
  assert.equal(PAD_RULES.moveDeadzone, .18); assert.equal(PAD_RULES.aimDeadzone, .3);
});

test('the stick turns like WASD: cardinals match exactly, diagonals match in heading', async () => {
  const keys = await keyboardInput();
  const cases = [[['KeyW'], [0, -1]], [['KeyS'], [0, 1]], [['KeyA'], [-1, 0]], [['KeyD'], [1, 0]]];
  for (const [codes, [right, down]] of cases) {
    keys.hold(...codes);
    const fromKeys = keys.sample();
    const { set, pad } = rig();
    set({ axes: [right, down, 0, 0] });
    close(pad.move[0], fromKeys.moveX, `${codes} x`); close(pad.move[1], fromKeys.moveY, `${codes} y`);
    const [isoX, isoY] = isoFromScreen(right, down);
    close(isoX, fromKeys.moveX); close(isoY, fromKeys.moveY);
  }
  for (const [codes, [right, down]] of [[['KeyW', 'KeyD'], [1, -1]], [['KeyS', 'KeyA'], [-1, 1]]]) {
    keys.hold(...codes);
    const fromKeys = keys.sample(), keyLength = Math.hypot(fromKeys.moveX, fromKeys.moveY);
    const { set, pad } = rig();
    set({ axes: [right * Math.SQRT1_2, down * Math.SQRT1_2, 0, 0] });
    close(pad.move[0], fromKeys.moveX / keyLength, `${codes} x`); close(pad.move[1], fromKeys.moveY / keyLength, `${codes} y`);
  }
});

test('buttons fire once per press; menu actions come from poll, gameplay actions from sample', () => {
  const { set, pad } = rig();
  assert.deepEqual(set({ pressed: [BUTTON.south] }), ['dash', 'nav:ok'], 'a press held when the pad appears still counts');
  assert.deepEqual(set({ pressed: [BUTTON.south] }), [], 'holding A does not repeat');
  assert.deepEqual(set({ pressed: [BUTTON.south] }), []);
  assert.deepEqual(set(), []);
  assert.deepEqual(set({ pressed: [BUTTON.south, BUTTON.start] }), ['dash', 'nav:ok', 'pause']);
  assert.deepEqual(set({ pressed: [BUTTON.west, BUTTON.north, BUTTON.east] }), ['slot:f', 'nav:back', 'slot:rmb', 'slot:q']);
  assert.deepEqual(pad.sample(player(), keyboard()).actions, ['slot:f', 'slot:rmb', 'slot:q']);
  assert.deepEqual(pad.sample(player(), keyboard()).actions, [], 'a second sample polls again and finds no new press');

  assert.deepEqual(set({ pressed: [BUTTON.select, BUTTON.rightBumper, BUTTON.up, BUTTON.right] }),
    ['interact', 'nav:next', 'panel', 'nav:up', 'nav:right']);
  assert.deepEqual(pad.sample(player(), keyboard()).actions, ['interact'], 'pause, panel and nav never reach the game loop');
  assert.deepEqual(set({ pressed: [BUTTON.leftBumper, BUTTON.down, BUTTON.left, BUTTON.touchpad] }),
    ['interact', 'nav:prev', 'nav:down', 'nav:left', 'panel']);
  assert.deepEqual(set({ pressed: [BUTTON.leftTrigger, BUTTON.leftStick, BUTTON.rightStick, BUTTON.home] }), [], 'LT, L3, R3 and Home stay free');
  assert.ok(['dash', 'interact', 'slot:q'].every(isGameplayAction));
  assert.ok(!['pause', 'panel', 'nav:ok'].some(isGameplayAction));
});

test('RT presses above .5 and releases below .3; its light-touch .pressed flag is ignored', () => {
  const { set, pad } = rig();
  const trigger = value => { set({ values: { [BUTTON.rightTrigger]: value } }); return pad.attack; };
  assert.deepEqual([.2, .45, .6, .45, .31, .29, .45, .51].map(trigger), [false, false, true, true, true, false, false, true]);
  assert.equal(pad.sample(player(), keyboard()).attack, true);
  trigger(0);
  assert.equal(pad.sample(player(), keyboard()).attack, false);
  assert.equal(pad.sample(player(), keyboard({ attack: true })).attack, true, 'the mouse button still attacks');
});

test('clear drops this frame presses and makes a held RT wait for a release', () => {
  const { set, pad } = rig();
  set({ pressed: [BUTTON.north], values: { [BUTTON.rightTrigger]: 1 } });
  assert.equal(pad.attack, true);
  pad.clear();
  assert.deepEqual(pad.sample(player(), keyboard()).actions, []);
  assert.equal(pad.attack, false);
  set({ values: { [BUTTON.rightTrigger]: 1 } });
  assert.equal(pad.attack, false, 'the trigger held through a menu does not swing on return');
  set();
  set({ values: { [BUTTON.rightTrigger]: 1 } });
  assert.equal(pad.attack, true);
});

test('the pad merges into the keyboard sample', () => {
  const { set, pad } = rig();
  assert.deepEqual(new GamepadInput({ getGamepads: () => [] }).sample(player(), keyboard({ moveX: 1 })), keyboard({ moveX: 1 }),
    'without a pad the keyboard sample passes through');

  set({ axes: [1, 0, 0, 0], pressed: [BUTTON.south] });
  const both = pad.sample(player(), keyboard({ actions: ['interact'], attack: true }));
  close(both.moveX, -Math.SQRT1_2); close(both.moveY, Math.SQRT1_2);
  assert.deepEqual(both.actions, ['interact', 'dash'], 'pad actions follow keyboard actions');
  assert.equal(both.attack, true);

  set({ axes: [0, .59, 0, 0] });
  const keyboardWins = pad.sample(player(), keyboard({ moveX: -Math.SQRT1_2 * 2, moveY: 0 }));
  close(keyboardWins.moveX, -Math.SQRT1_2 * 2, 'a full keyboard diagonal beats a half tilt');
  set({ axes: [0, .59, 0, 0] });
  const padWins = pad.sample(player(), keyboard());
  close(padWins.moveX, .5 * Math.SQRT1_2); close(padWins.moveY, .5 * Math.SQRT1_2);

  set({ axes: [0, 0, 1, 0] });
  const aimed = pad.sample(player(), keyboard({ aimX: 9, aimY: 9 }));
  close(aimed.aimX, -Math.SQRT1_2 * PAD_RULES.maxReach, 'the right stick beats the mouse');
  close(aimed.aimY, Math.SQRT1_2 * PAD_RULES.maxReach);
  assert.deepEqual(Object.keys(aimed).sort(), ['actions', 'aimX', 'aimY', 'attack', 'moveX', 'moveY']);
});

test('the aim follows the right stick, then the move heading, then holds the last heading', () => {
  const { set, pad } = rig();
  const aim = (options, base = keyboard({ aimX: 9, aimY: -9 })) => {
    set(options);
    const sample = pad.sample({ x: 0, y: 0, dx: 1, dy: 0 }, base), length = Math.hypot(sample.aimX, sample.aimY);
    return [sample.aimX / length, sample.aimY / length];
  };
  const near = ([x, y], [ex, ey], message) => { close(x, ex, message); close(y, ey, message); };
  near(aim({}), [Math.SQRT1_2, -Math.SQRT1_2], 'an untouched pad leaves the mouse aim');
  near(aim({ pressed: [BUTTON.south] }), [1, 0], 'after a pad press with no stick, the aim is the monk heading');
  near(aim({ axes: [0, 0, 0, -1] }), [-Math.SQRT1_2, -Math.SQRT1_2], 'the right stick aims up the screen');
  near(aim({}), [-Math.SQRT1_2, -Math.SQRT1_2], 'both sticks resting hold the last aim');
  near(aim({ axes: [0, .5, 0, 0] }), [Math.SQRT1_2, Math.SQRT1_2], 'with the right stick idle the aim follows the move');
  near(aim({ axes: [0, .5, -1, 0] }), [Math.SQRT1_2, -Math.SQRT1_2], 'the right stick beats the move heading');
  near(aim({}), [Math.SQRT1_2, -Math.SQRT1_2]);
});

test('the right-stick tilt sets the reach: deadzone edge = min, full tilt = max, a flick keeps its peak', () => {
  const { set, pad } = rig();
  const length = (axes, reach) => {
    set({ axes });
    const sample = pad.sample(player(), keyboard(), reach);
    return Math.hypot(sample.aimX, sample.aimY);
  };
  close(length([0, 0, .3001, 0]), PAD_RULES.minReach + (PAD_RULES.maxReach - PAD_RULES.minReach) * .0001 / .7, 'the deadzone edge reaches min');
  close(length([0, 0, 1, 0]), PAD_RULES.maxReach, 'full tilt reaches max');
  close(length([0, 0, .65, 0]), (PAD_RULES.minReach + PAD_RULES.maxReach) / 2, 'half the live range reaches half way');
  close(length([0, 0, 1, 0], { min: 1.5, max: 6.5 }), 6.5, 'the caller passes the crane range of the current modifier');
  // A flick: full tilt, then the spring back through .6 and .35 to the centre. The kept aim is the peak.
  for (const tilt of [1, .6, .35]) length([0, 0, tilt, 0]);
  close(length([0, 0, 0, 0]), PAD_RULES.maxReach, 'the spring back does not shorten the kept reach');
  const kept = pad.sample(player(), keyboard());
  close(kept.aimX / PAD_RULES.maxReach, -Math.SQRT1_2); close(kept.aimY / PAD_RULES.maxReach, Math.SQRT1_2);
  // A deliberate half tilt held longer than the memory, then released, keeps the half reach.
  for (let i = 0; i < PAD_RULES.aimMemory + 2; i++) length([0, 0, -.65, 0]);
  length([0, 0, -.4, 0]);
  close(length([0, 0, 0, 0]), (PAD_RULES.minReach + PAD_RULES.maxReach) / 2, 'a held half tilt keeps half the reach');
  // A new stroke forgets the old one, even when it is shorter than the memory.
  length([0, 0, 1, 0]); length([0, 0, 0, 0]);
  length([0, 0, 0, .4]);
  close(length([0, 0, 0, 0]), PAD_RULES.minReach + (PAD_RULES.maxReach - PAD_RULES.minReach) * (.1 / .7), 'a short tap keeps its own tilt');
  // A heading from the move or the facing has no tilt: it reaches aimReach.
  close(length([0, 1, 0, 0]), PAD_RULES.aimReach);
});

test('the last used device switches between pad and keyboard once per change', () => {
  const { set, pad, events } = rig();
  set();
  assert.equal(pad.device, 'keyboard');
  set({ axes: [0, 1, 0, 0] });
  pad.sample(player(), keyboard({ moveX: 1 }));
  assert.equal(pad.device, 'pad', 'a frame with pad input stays with the pad');
  set({ axes: [0, 1, 0, 0] });
  set();
  pad.sample(player(), keyboard());
  assert.equal(pad.device, 'pad', 'an idle frame changes nothing');
  set();
  pad.sample(player(), keyboard({ actions: ['dash'] }));
  assert.equal(pad.device, 'keyboard');
  set();
  pad.sample(player(), keyboard({ attack: true }));
  assert.deepEqual(events.filter(([type]) => type === 'device').map(([, detail]) => detail),
    [{ device: 'pad', family: 'xbox' }, { device: 'keyboard', family: 'xbox' }]);
});

test('a disconnect lets go of the held attack and the stick, and a new pad attaches', () => {
  const { pads, set, pad, events } = rig();
  set({ axes: [1, 0, 1, 0], values: { [BUTTON.rightTrigger]: 1 } });
  assert.equal(pad.attack, true);
  pads.length = 0;
  assert.deepEqual(pad.poll(), []);
  assert.equal(pad.connected, false); assert.equal(pad.attack, false); assert.equal(pad.family, null);
  const after = pad.sample(player(), keyboard());
  assert.deepEqual(after, keyboard(), 'nothing from the lost pad reaches the game');
  assert.deepEqual(events.map(([type]) => type), ['connected', 'device', 'disconnected', 'device']);
  assert.deepEqual(events[2][1], { index: 0, id: XBOX_ID, family: 'xbox' });

  set({ id: DUALSENSE_ID, values: { [BUTTON.rightTrigger]: 1 } });
  assert.equal(pad.family, 'playstation'); assert.equal(pad.attack, true);
  pads[0] = { ...fakePad({ id: DUALSENSE_ID }), connected: false };
  pad.poll();
  assert.equal(pad.attack, false, 'a pad reported as disconnected counts as gone');
  pads[0] = fakePad({ id: XBOX_ID });
  pad.poll();
  assert.equal(pad.family, 'xbox', 'a different pad at the same index is a new pad');
});

test('rumble plays a guarded dual-rumble effect and rumbleFor picks the strongest event', async () => {
  const calls = [];
  const actuator = { effects: ['dual-rumble', 'trigger-rumble'], playEffect: (type, params) => { calls.push([type, params]); return Promise.reject(new Error('preempted')); } };
  const { set, pad } = rig();
  assert.equal(pad.rumble(.5, 100), false, 'no pad, no rumble');
  set({ actuator });
  assert.equal(pad.rumble(2, 99.6), true);
  assert.deepEqual(calls, [['dual-rumble', { startDelay: 0, duration: 100, strongMagnitude: 1, weakMagnitude: 1 }]]);
  assert.equal(pad.rumble(0, 100), false); assert.equal(pad.rumble(.5, 0), false);
  await new Promise(resolve => setImmediate(resolve));

  set({ actuator: { effects: ['trigger-rumble'], playEffect: () => assert.fail('unsupported effect') } });
  assert.equal(pad.rumble(.5, 100), false);
  set({ actuator: { playEffect: () => { throw new Error('NotSupportedError'); } } });
  assert.equal(pad.rumble(.5, 100), false);
  set();
  assert.equal(pad.rumble(.5, 100), false, 'a pad without an actuator stays still');

  assert.equal(rumbleFor([]), null);
  assert.equal(rumbleFor([{ type: 'swing' }]), null);
  assert.deepEqual(rumbleFor([{ type: 'impact', strength: 'light' }]), { strength: .2, ms: 50 });
  assert.deepEqual(rumbleFor([{ type: 'impact', strength: 'light' }, { type: 'impact', strength: 'heavy' }, { type: 'block' }]), { strength: .55, ms: 110 });
  assert.deepEqual(rumbleFor([{ type: 'level-up' }, { type: 'impact' }]), { strength: .4, ms: 300 });
  assert.deepEqual(rumbleFor([{ type: 'hurt' }, { type: 'defeat' }]), { strength: 1, ms: 450 });
  calls.length = 0;
  set({ actuator });
  assert.equal(pad.rumbleEvents([{ type: 'level-up' }]), true);
  assert.equal(calls[0][1].duration, 300);
  assert.equal(pad.rumbleEvents([{ type: 'xp' }]), false);
  await new Promise(resolve => setImmediate(resolve));
});

test('holding() follows a held button of an action until its release or a disconnect', () => {
  const { pads, set, pad } = rig();
  set();
  assert.equal(pad.holding('slot:rmb'), false);
  set({ pressed: [BUTTON.west] });
  assert.equal(pad.holding('slot:rmb'), true);
  set({ pressed: [BUTTON.west] });
  assert.equal(pad.holding('slot:rmb'), true, 'a held □ stays held across polls');
  assert.equal(pad.holding('interact'), false);
  set({ pressed: [BUTTON.leftBumper] });
  assert.deepEqual([pad.holding('slot:rmb'), pad.holding('interact')], [false, true], 'either bumper holds interact');
  pads.length = 0; pad.poll();
  assert.equal(pad.holding('interact'), false, 'a lost pad holds nothing');
});

test('every slot has a pad button and a keycap in both families', () => {
  const pressedBy = action => Object.entries(BUTTON_ACTIONS).filter(([, actions]) => actions.includes(action)).map(([index]) => Number(index));
  assert.deepEqual(TECHNIQUE_SLOTS.map(slot => pressedBy(`slot:${slot}`)), [[BUTTON.west], [BUTTON.north], [BUTTON.east]]);
  assert.deepEqual(pressedBy('dash'), [BUTTON.south]);
  assert.deepEqual(pressedBy('pause'), [BUTTON.start]);
  const slotKeys = family => SLOTS.map(slot => slotKey(controlKeys(family), slot.id));
  assert.deepEqual(slotKeys('playstation'), ['R2', '✕', '□', '△', '○']);
  assert.deepEqual(slotKeys('xbox'), ['RT', 'A', 'X', 'Y', 'B']);
  assert.deepEqual(slotKeys('generic'), ['RT', 'A', 'X', 'Y', 'B']);
  assert.deepEqual(slotKeys(null), SLOTS.map(slot => slot.label), 'the keyboard keycaps are the SLOTS labels');
  assert.equal(controlKeys('unknown'), PAD_GLYPHS.xbox);
  // One vocabulary for every device: the panel, the notices and the legend may ask any of them for any key.
  for (const keys of [PAD_GLYPHS.playstation, PAD_GLYPHS.xbox]) assert.deepEqual(Object.keys(keys).sort(), Object.keys(KEYBOARD_KEYS).sort());
  // The panel names the hold, the tab keys and the way back; a pad opens every tab with its one panel button.
  assert.deepEqual(['nav:ok', 'drop', 'nav:back', 'skills', 'path', 'gear', 'gearTab'].map(key => [KEYBOARD_KEYS[key], PAD_GLYPHS.playstation[key], PAD_GLYPHS.xbox[key]]),
    [['ЛКМ', '✕', 'A'], ['ПКМ', '□', 'X'], ['Esc', '○', 'B'], ['K', 'Create', 'View'], ['C', 'Create', 'View'], ['I', 'Create', 'View'], ['I', 'L1', 'LB']]);
  assert.equal(PAD_GLYPHS.playstation.drop, PAD_GLYPHS.playstation['slot:rmb'], 'the drop hold is the RMB-slot button');
  assert.ok(Object.isFrozen(KEYBOARD_KEYS));
  assert.ok(Object.isFrozen(BUTTON_ACTIONS) && Object.isFrozen(BUTTON_ACTIONS[BUTTON.south]) && Object.isFrozen(PAD_GLYPHS.xbox));
});
