// Gamepad input through the standard Gamepad API. The module has no engine or DOM code:
// the caller injects getGamepads (navigator.getGamepads in the browser, fakes in tests).
// poll() reads the active pad once per frame and returns that frame's button presses;
// sample() merges the pad into the keyboard and mouse sample of Input.sample.
const freeze = Object.freeze;

// Button indices of the 'standard' mapping (w3c.github.io/gamepad/#remapping).
export const BUTTON = freeze({
  south: 0, east: 1, west: 2, north: 3, leftBumper: 4, rightBumper: 5, leftTrigger: 6, rightTrigger: 7,
  select: 8, start: 9, leftStick: 10, rightStick: 11, up: 12, down: 13, left: 14, right: 15, home: 16, touchpad: 17,
});

// One press of a button emits these actions once. 'dash', 'interact' and 'slot:*' are gameplay
// actions: sample() appends them to the keyboard actions. 'pause', 'panel' and 'nav:*' come only
// from poll(), because menus read them while the game does not sample. RT holds the attack (see poll).
// LB and RB both interact in play and switch the «Монах» tabs in the panel ('nav:prev', 'nav:next').
// LT, L3, R3 and Home stay free; the browser or the OS owns Home.
export const BUTTON_ACTIONS = freeze({
  [BUTTON.south]: freeze(['dash', 'nav:ok']),
  [BUTTON.east]: freeze(['slot:f', 'nav:back']),
  [BUTTON.west]: freeze(['slot:rmb']),
  [BUTTON.north]: freeze(['slot:q']),
  [BUTTON.leftBumper]: freeze(['interact', 'nav:prev']),
  [BUTTON.rightBumper]: freeze(['interact', 'nav:next']),
  [BUTTON.select]: freeze(['panel']),
  [BUTTON.start]: freeze(['pause']),
  [BUTTON.up]: freeze(['nav:up']),
  [BUTTON.down]: freeze(['nav:down']),
  [BUTTON.left]: freeze(['nav:left']),
  [BUTTON.right]: freeze(['nav:right']),
  [BUTTON.touchpad]: freeze(['panel']),
});
export const isGameplayAction = action => action === 'dash' || action === 'interact' || action.startsWith('slot:');

// Deadzones are radial, in stick units. The trigger presses above triggerPress and releases
// below triggerRelease. The aim length is a reach in world units; the crane hop reads it.
// A right-stick aim reaches from minReach at the deadzone edge to maxReach at full tilt;
// an aim from the move heading or the facing reaches aimReach. aimMemory is the number of
// polls before a release that the stick remembers: the firmest of them is the kept aim,
// so the spring back to the centre does not shorten it.
export const PAD_RULES = freeze({
  moveDeadzone: .18, aimDeadzone: .3, triggerPress: .5, triggerRelease: .3,
  aimReach: 4, minReach: 1.5, maxReach: 5, aimMemory: 6,
});

// Keycaps for HUD, legend, panel and notices. 'nav:ok' presses a panel control, drop is held on a
// bag item. path, gear and skills open those «Монах» tabs from play: the keyboard has a key for each,
// a pad opens the panel with one button. gearTab reaches «Снаряжение» from «Умения» inside the panel.
export const KEYBOARD_KEYS = freeze({
  move: 'WASD', aim: 'мышь', attack: 'ЛКМ', dash: 'Пробел', 'slot:rmb': 'ПКМ', 'slot:q': 'Q', 'slot:f': 'F',
  interact: 'E', pause: 'Esc', panel: 'C / I / K', tabs: 'Tab', 'nav:ok': 'ЛКМ', 'nav:back': 'Esc',
  drop: 'ПКМ', path: 'C', gear: 'I', skills: 'K', gearTab: 'I',
});
// A generic pad uses the Xbox names: the standard mapping places its buttons as on an Xbox pad.
const XBOX_GLYPHS = freeze({
  move: 'L-стик', aim: 'R-стик', attack: 'RT', dash: 'A', 'slot:rmb': 'X', 'slot:q': 'Y', 'slot:f': 'B',
  interact: 'RB', pause: 'Menu', panel: 'View', tabs: 'LB / RB', 'nav:ok': 'A', 'nav:back': 'B',
  drop: 'X', path: 'View', gear: 'View', skills: 'View', gearTab: 'LB',
});
export const PAD_GLYPHS = freeze({
  playstation: freeze({
    move: 'L-стик', aim: 'R-стик', attack: 'R2', dash: '✕', 'slot:rmb': '□', 'slot:q': '△', 'slot:f': '○',
    interact: 'R1', pause: 'Options', panel: 'Create', tabs: 'L1 / R1', 'nav:ok': '✕', 'nav:back': '○',
    drop: '□', path: 'Create', gear: 'Create', skills: 'Create', gearTab: 'L1',
  }),
  xbox: XBOX_GLYPHS,
  generic: XBOX_GLYPHS,
});
// Phone labels (docs/design/mobile-touch.md §5, question 4): the buttons by name, the technique slots 1 · 2 · 3.
// touch marks the set, so the panel and the hints can say «коснись» instead of naming a key.
export const TOUCH_KEYS = freeze({
  touch: true,
  move: 'Джойстик', aim: 'автоприцел', attack: '«Удар»', dash: '«Шаг»', 'slot:rmb': '1', 'slot:q': '2', 'slot:f': '3',
  interact: 'Рука', pause: '«Пауза»', panel: '«Монах»', tabs: 'Вкладки', 'nav:ok': 'Касание', 'nav:back': '✕',
  drop: '«Держи — выбросить»', path: '«Монах»', gear: '«Монах»', skills: '«Монах»', gearTab: '«Снаряжение»',
});
// The keycaps of a pad family; 'touch' gives the phone labels; null (or an unknown family) the keyboard ones.
export const controlKeys = family => family === 'touch' ? TOUCH_KEYS : family ? PAD_GLYPHS[family] ?? XBOX_GLYPHS : KEYBOARD_KEYS;
const SLOT_ACTIONS = freeze({ lmb: 'attack', space: 'dash' });
// The keycap of a SLOTS id (skills.js) among those keys.
export const slotKey = (keys, slotId) => keys[SLOT_ACTIONS[slotId] ?? `slot:${slotId}`];

// Chrome writes 'Vendor: 054c', Firefox starts the id with '054c-', Safari gives only the product name.
const PLAYSTATION = /vendor:\s*0*54c\b|^0*54c-|dualsense|dualshock|playstation|\bps[345]\b/i;
const XBOX = /vendor:\s*0*45e\b|^0*45e-|xbox|x-box|xinput|microsoft/i;
export const padFamily = (id = '') => PLAYSTATION.test(id) ? 'playstation' : XBOX.test(id) ? 'xbox' : 'generic';

// Inside the deadzone the stick reads zero. Outside it the length rescales from 0 to 1
// and the direction stays, so a half tilt walks at half speed. Returns [x, y, length].
export function radialDeadzone(x, y, deadzone) {
  const length = Math.hypot(x, y);
  if (!(length > deadzone)) return [0, 0, 0];
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return [x / length * scaled, y / length * scaled, scaled];
}

// Screen right and down to world axes: the turn that Input.sample gives WASD.
export const isoFromScreen = (right, down) => [(down - right) * Math.SQRT1_2, (down + right) * Math.SQRT1_2];

// Rumble per game event, as strength 0..1 and milliseconds. The strongest event of a frame plays.
export const RUMBLE = freeze({
  'impact:light': freeze({ strength: .2, ms: 50 }),
  'impact:heavy': freeze({ strength: .55, ms: 110 }),
  block: freeze({ strength: .15, ms: 50 }),
  'guard-break': freeze({ strength: .5, ms: 120 }),
  'deflect-success': freeze({ strength: .35, ms: 80 }),
  'crane-land': freeze({ strength: .5, ms: 120 }),
  hurt: freeze({ strength: .7, ms: 160 }),
  'last-breath': freeze({ strength: .8, ms: 260 }),
  'level-up': freeze({ strength: .4, ms: 300 }),
  defeat: freeze({ strength: 1, ms: 450 }),
});
export function rumbleFor(events = []) {
  let best = null;
  for (const event of events) {
    const effect = RUMBLE[event.type === 'impact' ? `impact:${event.strength === 'heavy' ? 'heavy' : 'light'}` : event.type];
    if (effect && (!best || effect.strength > best.strength)) best = effect;
  }
  return best;
}

const isPressed = button => button != null && (typeof button === 'number' ? button > .5 : button.pressed === true || button.value > .5);
const valueOf = button => button == null ? 0 : typeof button === 'number' ? button : button.value ?? (button.pressed ? 1 : 0);
const unit = (x, y) => { const length = Math.hypot(x, y) || 1; return [x / length, y / length]; };
// An aim is a unit heading and the right-stick tilt it came with; tilt null means a heading without one.
const heading = (x, y, tilt = null) => { const [ux, uy] = unit(x, y); return { x: ux, y: uy, tilt }; };
const EMPTY_ACTIONS = Object.freeze([]);
const BUTTON_ENTRIES = Object.entries(BUTTON_ACTIONS);
function readPads(getGamepads) {
  try { return getGamepads(); } catch { return null; }
}

export class GamepadInput {
  // onEvent(type, detail) hears 'connected' and 'disconnected' of the active pad, and 'device'
  // when the last used device changes between 'pad' and 'keyboard' (HUD keycaps follow it).
  constructor({ getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [], onEvent = () => {}, rules = {} } = {}) {
    this.getGamepads = getGamepads; this.onEvent = onEvent; this.rules = { ...PAD_RULES, ...rules };
    this.pad = null; this.index = -1; this.id = ''; this.family = null; this.standard = false;
    this.device = 'keyboard'; this.active = false; this.fresh = false;
    this.held = []; this.trigger = false; this.suppressAttack = false; this.attack = false;
    this.move = [0, 0]; this.aimStick = null; this.lastAim = null; this.stroke = []; this.actions = [];
  }
  get connected() { return this.index >= 0; }

  // Reads the pad. Call once per frame, before sample(). Returns every action pressed this frame.
  poll() {
    const pads = readPads(this.getGamepads);
    let pad, first, standard;
    // Browser pad lists are sparse and may be array-like. Do not copy/filter them every frame.
    for (let i = 0; i < (pads?.length ?? 0); i++) {
      const item = pads[i];
      if (!item || item.connected === false) continue;
      first ??= item;
      if (item.mapping === 'standard') standard ??= item;
      if (this.connected && item.index === this.index && item.id === this.id) pad = item;
    }
    if (this.connected && !pad) this.release();
    if (!pad && (pad = standard ?? first)) this.attach(pad);
    this.pad = pad ?? null; this.actions = EMPTY_ACTIONS; this.active = false; this.fresh = true;
    if (!pad) return this.actions;
    const { moveDeadzone, aimDeadzone, triggerPress, triggerRelease } = this.rules;
    const axes = pad.axes ?? [], buttons = pad.buttons ?? [];
    const [moveRight, moveDown, moveLength] = radialDeadzone(axes[0] ?? 0, axes[1] ?? 0, moveDeadzone);
    const [aimRight, aimDown, aimLength] = radialDeadzone(axes[2] ?? 0, axes[3] ?? 0, aimDeadzone);
    this.move = isoFromScreen(moveRight, moveDown);
    // The aim falls back to the move heading, then holds the last heading while both sticks rest.
    // A released stick keeps the firmest tilt of its last aimMemory polls.
    if (aimLength > 0) {
      if (!this.aimStick) this.stroke = [];
      this.aimStick = heading(...isoFromScreen(aimRight, aimDown), aimLength);
      this.stroke.push(this.aimStick);
      if (this.stroke.length > this.rules.aimMemory) this.stroke.shift();
      this.lastAim = this.aimStick;
    } else {
      if (this.aimStick) this.lastAim = this.stroke.reduce((best, aim) => aim.tilt > best.tilt ? aim : best);
      this.aimStick = null;
      if (moveLength > 0) this.lastAim = heading(...this.move);
    }
    // RT reads its analog value with hysteresis: Chrome sets .pressed at a light touch.
    const value = valueOf(buttons[BUTTON.rightTrigger]);
    this.trigger = this.trigger ? value > triggerRelease : value > triggerPress;
    if (!this.trigger) this.suppressAttack = false;
    this.attack = this.trigger && !this.suppressAttack;
    for (const [index, actions] of BUTTON_ENTRIES) {
      const down = isPressed(buttons[index]);
      if (down && !this.held[index]) {
        if (this.actions === EMPTY_ACTIONS) this.actions = [];
        this.actions.push(...actions);
      }
      this.held[index] = down;
    }
    this.active = moveLength > 0 || aimLength > 0 || this.trigger || this.actions.length > 0;
    if (this.active) this.setDevice('pad');
    return this.actions;
  }

  // Merges the pad into base, the keyboard and mouse sample. The pad move wins when it is longer
  // than the keyboard move. The pad aim wins while the right stick is tilted, or while the pad
  // is the last used device. attack is RT or the mouse. Gameplay actions follow the keyboard ones.
  // reach { min, max } overrides minReach and maxReach, so full tilt meets the crane's current range.
  sample(player, base = { moveX: 0, moveY: 0, aimX: player?.dx ?? 0, aimY: player?.dy ?? 1, attack: false, actions: [] }, reach = {}) {
    if (!this.fresh) this.poll();
    this.fresh = false;
    const keyboardMove = Math.hypot(base.moveX, base.moveY);
    if (!this.active && (keyboardMove > .001 || base.attack || base.actions.length > 0)) this.setDevice('keyboard');
    if (!this.connected) return base;
    const [padX, padY] = this.move, padMove = Math.min(1, keyboardMove) < Math.hypot(padX, padY);
    const aim = this.aimStick ?? (this.device === 'pad' ? this.lastAim ?? heading(player?.dx ?? 0, player?.dy ?? 1) : null);
    const length = aim ? this.reach(aim, reach) : 0;
    return {
      ...base,
      moveX: padMove ? padX : base.moveX, moveY: padMove ? padY : base.moveY,
      aimX: aim ? aim.x * length : base.aimX, aimY: aim ? aim.y * length : base.aimY,
      attack: base.attack || this.attack,
      actions: [...base.actions, ...this.actions.filter(isGameplayAction)],
    };
  }

  reach(aim, { min = this.rules.minReach, max = this.rules.maxReach } = {}) {
    return aim.tilt === null ? this.rules.aimReach : min + (max - min) * aim.tilt;
  }

  // Drops this frame's presses. A held RT attacks again only after a release, like the mouse after Input.clear.
  clear() { this.actions = []; this.attack = false; this.suppressAttack = this.trigger; }

  // The keycaps to show: the pad's while it is the last used device, else the keyboard's.
  keys() { return controlKeys(this.device === 'pad' ? this.family : null); }

  // True while a button of this action is down, for holds such as □ / X on a bag item.
  holding(action) {
    return BUTTON_ENTRIES.some(([index, actions]) => actions.includes(action) && this.held[index]);
  }

  // Plays a dual rumble when the pad supports it. Returns true when the effect started.
  rumble(strength, ms) {
    const actuator = this.pad?.vibrationActuator;
    const magnitude = Math.min(1, Math.max(0, Number(strength) || 0));
    const duration = Math.min(5000, Math.max(0, Math.round(Number(ms) || 0)));
    if (typeof actuator?.playEffect !== 'function' || magnitude === 0 || duration === 0) return false;
    if (Array.isArray(actuator.effects) && !actuator.effects.includes('dual-rumble')) return false;
    try {
      const done = actuator.playEffect('dual-rumble', { startDelay: 0, duration, strongMagnitude: magnitude, weakMagnitude: magnitude });
      done?.catch?.(() => {});
      return true;
    } catch { return false; }
  }
  rumbleEvents(events) {
    const effect = rumbleFor(events);
    return effect ? this.rumble(effect.strength, effect.ms) : false;
  }

  // The last used device. main.js calls setDevice('keyboard') on keys and mouse moves.
  setDevice(device) {
    if (this.device === device) return;
    this.device = device;
    this.onEvent('device', { device, family: this.family });
  }
  attach(pad) {
    this.index = pad.index; this.id = pad.id; this.family = padFamily(pad.id); this.standard = pad.mapping === 'standard';
    this.onEvent('connected', { index: this.index, id: this.id, family: this.family, standard: this.standard });
  }
  // A lost pad lets go of everything it held.
  release() {
    const detail = { index: this.index, id: this.id, family: this.family };
    this.pad = null; this.index = -1; this.id = ''; this.family = null; this.standard = false;
    this.held = []; this.trigger = false; this.suppressAttack = false; this.attack = false;
    this.move = [0, 0]; this.aimStick = null; this.lastAim = null; this.stroke = []; this.actions = [];
    this.onEvent('disconnected', detail);
    this.setDevice('keyboard');
  }
}
