// Touch input for phones (docs/design/mobile-touch.md). The module has no engine or DOM code:
// touch-ui.js forwards pointer events in CSS px, tests inject them. Fingers own what they touched
// first (§10); sample() merges the touch controls into the keyboard sample like GamepadInput.sample.
import { isoFromScreen } from './gamepad.js';
import { weaponCombo } from './items.js';
import { skillParams, slotStates } from './run-progress.js';

const freeze = Object.freeze;

// Sizes are in u (§ Термины: u = 2 CSS px on a phone), angles in degrees, reaches in world units.
// stickRest is the resting stick centre from the safe left and bottom edges; attackFromEdge is the
// attack centre from the safe right and bottom edges. cancel is the «Отмена» chip under the spirit
// plate; its touch zone grows by pad. headingReach is the cast reach along F when no enemy is found.
export const TOUCH_RULES = freeze({
  u: 2,
  stickZone: .45, stickTop: 48, stickRest: freeze([50, 42]),
  stickBase: 52, stickKnob: 22, stickTravel: 20, stickDeadzone: 4,
  attackFromEdge: freeze([33, 36]), attackSize: 40, attackZone: 48, slotSize: 28, slotZone: 32,
  rightFingers: 2, aimThreshold: 6, aimRadius: 36,
  cancel: freeze({ top: 46, right: 4, width: 40, height: 22, pad: 2 }),
  cone: 60, tie: .3, holdSlack: .6, attackReachBonus: .5, markTime: .5, headingReach: 4,
});

// Button centres from the attack centre in u, +y down (§4.2), keyed by the SLOTS ids of skills.js.
export const CLUSTER = freeze({
  lmb: freeze([0, 0]), space: freeze([-50, 18]), rmb: freeze([-50, -20]), q: freeze([-24, -54]), f: freeze([14, -46]),
});

// Screen height of one world unit over its width: the 2:1 projection (render.js snapToLattice, v / 2).
export const ISO_SQUASH = .5;

const unit = (x, y) => { const length = Math.hypot(x, y); return length > 1e-9 ? [x / length, y / length] : null; };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Where everything sits on a screen of width × height CSS px with safe-area insets (§2, §4).
export function touchLayout({ width, height, safe = {}, u = TOUCH_RULES.u }, rules = TOUCH_RULES) {
  const edge = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const ax = width - edge.right - rules.attackFromEdge[0] * u, ay = height - edge.bottom - rules.attackFromEdge[1] * u;
  const buttons = {};
  for (const [id, [dx, dy]] of Object.entries(CLUSTER)) {
    const round = id === 'lmb';
    buttons[id] = freeze({ id, round, x: ax + dx * u, y: ay + dy * u,
      size: (round ? rules.attackSize : rules.slotSize) * u, zone: (round ? rules.attackZone : rules.slotZone) * u });
  }
  const chip = rules.cancel;
  return freeze({
    width, height, u, safe: freeze(edge), buttons: freeze(buttons),
    stick: freeze({ left: edge.left, right: width * rules.stickZone, top: edge.top + rules.stickTop * u, bottom: height - edge.bottom }),
    rest: freeze({ x: edge.left + rules.stickRest[0] * u, y: height - edge.bottom - rules.stickRest[1] * u }),
    cancel: freeze({ left: width - edge.right - (chip.right + chip.width) * u, top: edge.top + chip.top * u,
      width: chip.width * u, height: chip.height * u, pad: chip.pad * u }),
  });
}

// The phone screen to show (§2.5, §11): 'rotate' in portrait, 'small' below 568×320, else 'play'.
// Portrait matches the CSS media feature: height at least the width.
export function screenState({ width, height }) {
  if (height >= width) return 'rotate';
  return width < 568 || height < 320 ? 'small' : 'play';
}

export const inStickZone = (layout, x, y) => {
  const zone = layout.stick;
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
};

// A touch inside several zones goes to the nearest button centre (§9.5). Zones never overlap
// on the spec layout, so this only matters on a squeezed screen.
export function hitButton(layout, x, y) {
  let best = null, nearest = Infinity;
  for (const button of Object.values(layout.buttons)) {
    const dx = x - button.x, dy = y - button.y, half = button.zone / 2, distance = Math.hypot(dx, dy);
    const inside = button.round ? distance <= half : Math.abs(dx) <= half && Math.abs(dy) <= half;
    if (inside && distance < nearest) { best = button; nearest = distance; }
  }
  return best;
}

export function inCancel(layout, x, y) {
  const chip = layout.cancel;
  return x >= chip.left - chip.pad && x <= chip.left + chip.width + chip.pad
    && y >= chip.top - chip.pad && y <= chip.top + chip.height + chip.pad;
}

// The base lands centred under the finger, moved inside the zone when it does not fit (§4.3.1).
// The moved base stays inside: the knob leans toward the finger, at most travel px.
export function placeStick(layout, x, y, rules = TOUCH_RULES) {
  const zone = layout.stick, radius = rules.stickBase / 2 * layout.u, travel = rules.stickTravel * layout.u;
  const baseX = zone.right - zone.left >= 2 * radius ? clamp(x, zone.left + radius, zone.right - radius) : x;
  const baseY = zone.bottom - zone.top >= 2 * radius ? clamp(y, zone.top + radius, zone.bottom - radius) : y;
  const dx = x - baseX, dy = y - baseY, scale = Math.min(1, travel / (Math.hypot(dx, dy) || 1));
  return { baseX, baseY, knobX: dx * scale, knobY: dy * scale };
}

// The knob follows the finger up to travel px; further out the base follows the finger (§4.3.2–3).
export function dragStick(stick, x, y, travel) {
  let dx = x - stick.baseX, dy = y - stick.baseY;
  const distance = Math.hypot(dx, dy);
  if (distance > travel) {
    dx *= travel / distance; dy *= travel / distance;
    stick.baseX = x - dx; stick.baseY = y - dy;
  }
  stick.knobX = dx; stick.knobY = dy;
  return stick;
}

// The world move of a knob offset: zero inside the deadzone, else full speed in any of 360°
// (§4.3.4–5, question 8), turned like WASD in input.js.
export function stickMove(dx, dy, deadzone) {
  if (!(Math.hypot(dx, dy) > deadzone)) return [0, 0];
  const [right, down] = unit(dx, dy);
  return isoFromScreen(right, down);
}

// A screen direction to the world direction that projects onto it: the drag line on the ground
// follows the finger (§8.2). Returns a unit vector, or null for no direction.
export function worldFromScreen(right, down) {
  const heading = unit(right, down);
  return heading && unit(...isoFromScreen(heading[0], heading[1] / ISO_SQUASH));
}

// The manual aim of a drag (§8.2): button centre → finger on screen, in the world. Point techniques
// reach min + (max − min) × min(length / radius, 1); a palm has min = max.
export function manualAim(dx, dy, { min, max }, radius) {
  const heading = worldFromScreen(dx, dy);
  if (!heading) return null;
  const reach = min + (max - min) * Math.min(Math.hypot(dx, dy) / radius, 1);
  return [heading[0] * reach, heading[1] * reach];
}

// Only living, open bodies can be targets. A sealed ritual source ignores hits until it opens.
export const targetable = enemy => enemy.hp > 0 && !enemy.sealed && enemy.state !== 'dead';

// Rule A (§8.1). forward is F in the world, reach is R, contact is the attack R. The nearest
// enemy in the ±cone of F closer than R wins, else the nearest one closer than contact in any
// direction, else null. Of two enemies less than tie apart in distance, the one nearer the F axis wins.
export function autoAimTarget(player, enemies, { forward, reach, contact = reach, rules = TOUCH_RULES }) {
  const [fx, fy] = unit(...forward) ?? unit(player.dx, player.dy) ?? [0, 1];
  const minCos = Math.cos(rules.cone * Math.PI / 180) - 1e-9;
  const ahead = [], close = [];
  for (const enemy of enemies ?? []) {
    if (!targetable(enemy)) continue;
    const ex = enemy.x - player.x, ey = enemy.y - player.y, distance = Math.hypot(ex, ey);
    const along = distance > 1e-6 ? (ex * fx + ey * fy) / distance : 1;
    const entry = { enemy, distance, along };
    if (distance < reach && along >= minCos) ahead.push(entry);
    if (distance < contact) close.push(entry);
  }
  const pick = list => {
    if (!list.length) return null;
    const nearest = Math.min(...list.map(entry => entry.distance));
    return list.filter(entry => entry.distance - nearest < rules.tie).reduce((best, entry) => entry.along > best.along ? entry : best).enemy;
  };
  return pick(ahead) ?? pick(close);
}

// R of the attack: the last strike of the equipped series + .5 (bare hands: 1.9 + .5 = 2.4).
export const attackReach = (game, rules = TOUCH_RULES) =>
  weaponCombo(game?.inventory?.equipped?.weapon ?? null).range.at(-1) + rules.attackReachBonus;

// Techniques with an aim (§8.1) and their reach; the rest need none and fire on the touch (§6).
export function techniqueReach(skillId, params) {
  if (skillId === 'palm') return { min: params.range, max: params.range };
  if (skillId === 'crane') return { min: params.minRange, max: params.range };
  if (skillId === 'bell') return { min: 0, max: params.castRange };
  return null;
}

const toward = (player, enemy) => [enemy.x - player.x, enemy.y - player.y];
const now = () => (globalThis.performance?.now() ?? Date.now()) / 1000;

export class TouchInput {
  // getGame returns the run (slot states, enemies, weapon); isActive gates new touches like Input.
  // clock returns seconds and times the target corners.
  constructor({ getGame = () => null, isActive = () => true, clock = now, rules = {} } = {}) {
    this.getGame = getGame; this.isActive = isActive; this.clock = clock; this.rules = { ...TOUCH_RULES, ...rules };
    this.layout = null; this.device = 'keyboard';
    this.fingers = new Map(); this.stick = null; this.queue = [];
    this.attackTarget = null; this.preview = null; this.mark = null;
  }

  // The screen in CSS px: { width, height, safe: { top, right, bottom, left }, u }.
  resize(viewport) { this.layout = touchLayout(viewport, this.rules); return this.layout; }

  get attack() { return [...this.fingers.values()].some(finger => finger.slot === 'lmb'); }
  // The slots under a finger now: the UI draws them pressed (§7).
  get pressed() { return new Set([...this.fingers.values()].filter(finger => finger.slot).map(finger => finger.slot)); }
  // The stick to draw: under the finger, or resting at its default place (§4.3.6).
  get stickView() {
    if (this.stick) return { held: true, ...this.stick };
    const rest = this.layout?.rest ?? { x: 0, y: 0 };
    return { held: false, baseX: rest.x, baseY: rest.y, knobX: 0, knobY: 0 };
  }
  // The technique finger in aim mode, for the circle, the finger mark and «Отмена» (§8.2).
  get aiming() {
    const finger = [...this.fingers.values()].find(item => item.mode === 'aim');
    if (!finger) return null;
    const button = this.layout.buttons[finger.slot];
    return { slot: finger.slot, buttonX: button.x, buttonY: button.y, x: finger.x, y: finger.y, cancel: finger.cancel };
  }
  // The enemy to mark with corners: the current target, and for markTime after it (§8.1.3).
  get markedTarget() { return this.mark && this.clock() < this.mark.until ? this.mark.id : null; }

  // A new finger. Returns what it owns ('stick', a slot id) or null when it is skipped (§10).
  pointerDown({ pointerId, x, y }) {
    if (!this.layout || this.fingers.has(pointerId) || !this.isActive()) return null;
    if (inStickZone(this.layout, x, y)) {
      if (this.stick) return null;
      this.stick = placeStick(this.layout, x, y, this.rules);
      this.fingers.set(pointerId, { role: 'stick' });
      this.device = 'touch';
      return 'stick';
    }
    const button = hitButton(this.layout, x, y);
    const right = [...this.fingers.values()].filter(finger => finger.slot).length;
    if (!button || right >= this.rules.rightFingers) return null;
    const finger = { role: 'button', slot: button.id, x0: x, y0: y, x, y, mode: 'press', cancel: false };
    if (button.id === 'space') this.queue.push({ action: 'dash' });
    else if (button.id !== 'lmb') {
      // An aimed technique waits for the release; any other touch casts now. A slot on cooldown,
      // short of spirit, empty or locked casts now too and gets the desktop refusal (§6).
      if (this.aimedSlot(button.id)) finger.mode = 'pending';
      else this.queue.push({ action: `slot:${button.id}`, aim: 'auto' });
    }
    this.fingers.set(pointerId, finger);
    this.device = 'touch';
    return button.id;
  }

  pointerMove({ pointerId, x, y }) {
    const finger = this.fingers.get(pointerId);
    if (!finger) return;
    if (finger.role === 'stick') { dragStick(this.stick, x, y, this.rules.stickTravel * this.layout.u); return; }
    finger.x = x; finger.y = y;
    if (finger.mode === 'pending' && Math.hypot(x - finger.x0, y - finger.y0) >= this.rules.aimThreshold * this.layout.u) finger.mode = 'aim';
    if (finger.mode === 'aim') finger.cancel = inCancel(this.layout, x, y);
  }

  // An aimed technique fires on the release: by rule A after a short touch, along the finger
  // after a drag, and not at all over «Отмена» (§8.2).
  pointerUp({ pointerId, x, y }) {
    const finger = this.fingers.get(pointerId);
    if (!finger) return;
    if (x !== undefined && y !== undefined) this.pointerMove({ pointerId, x, y });
    this.fingers.delete(pointerId);
    if (finger.role === 'stick') { this.stick = null; return; }
    const button = this.layout.buttons[finger.slot];
    if (finger.mode === 'pending') this.queue.push({ action: `slot:${finger.slot}`, aim: 'auto' });
    else if (finger.mode === 'aim' && !finger.cancel) {
      this.queue.push({ action: `slot:${finger.slot}`, aim: 'manual', dx: finger.x - button.x, dy: finger.y - button.y });
    }
  }

  // «E» and «Монах» are DOM buttons; they queue their actions here.
  tap(action) { this.queue.push({ action }); this.device = 'touch'; }

  // A cancelled pointer, a call, the shade, a hidden tab or a turn (§10.7): every finger lets go,
  // the monk stands, an aim ends without a cost. Fingers still down stay ignored until they lift.
  clear() {
    this.fingers.clear(); this.stick = null; this.queue = [];
    this.attackTarget = null; this.preview = null;
  }

  // Merges touch into base, the keyboard (and pad) sample. While touch is the last used device it
  // owns the move, the aim and the attack; touch actions follow the base actions. aims maps each
  // cast of this frame to its aim, and aimX, aimY carry the last cast so main.js casts unchanged.
  sample(player, base = { moveX: 0, moveY: 0, aimX: player?.dx ?? 0, aimY: player?.dy ?? 1, attack: false, actions: [] },
    game = this.getGame()) {
    const busy = this.fingers.size > 0 || this.queue.length > 0;
    if (!busy && (Math.hypot(base.moveX, base.moveY) > .001 || base.attack || base.actions.length > 0)) this.device = 'keyboard';
    if (this.device !== 'touch' || !player) { this.preview = null; this.attackTarget = null; return base; }
    const travel = this.stick ? this.stickTravelVector() : [0, 0];
    const [moveX, moveY] = travel;
    const moving = Math.hypot(moveX, moveY) > .001;
    const forward = moving ? [moveX, moveY] : [player.dx, player.dy];
    const enemies = game?.enemies ?? [], contact = attackReach(game, this.rules);
    let [aimX, aimY] = unit(...forward) ?? [0, 1];
    // Rule A for the attack. A held attack keeps its target while it lives within R + holdSlack (§8.1.1).
    if (this.attack) {
      const kept = this.attackTarget && targetable(this.attackTarget)
        && Math.hypot(...toward(player, this.attackTarget)) < contact + this.rules.holdSlack;
      this.attackTarget = kept ? this.attackTarget
        : autoAimTarget(player, enemies, { forward, reach: contact, contact, rules: this.rules });
      if (this.attackTarget) [aimX, aimY] = toward(player, this.attackTarget);
    } else this.attackTarget = null;
    this.preview = this.previewOf(player, game, forward, contact);
    const actions = [], aims = {};
    for (const entry of this.queue.splice(0)) {
      actions.push(entry.action);
      if (!entry.aim) continue;
      const aim = this.castAim(entry, player, game, forward, contact);
      aims[entry.action] = { x: aim[0], y: aim[1] };
      [aimX, aimY] = aim;
    }
    const target = this.attackTarget ?? this.preview?.target ?? null;
    if (target) this.mark = { id: target.id, until: this.clock() + this.rules.markTime };
    return {
      ...base,
      moveX: moving ? moveX : base.moveX, moveY: moving ? moveY : base.moveY,
      aimX, aimY, attack: base.attack || this.attack, actions: [...base.actions, ...actions], aims,
    };
  }

  stickTravelVector() { return stickMove(this.stick.knobX, this.stick.knobY, this.rules.stickDeadzone * this.layout.u); }

  // An aimed technique slot that can cast now: it waits for the release (§8.2).
  aimedSlot(slot, game = this.getGame()) {
    return !!game && !!slotStates(game).find(item => item.slot === slot)?.ready && !!techniquePlan(game, slot);
  }

  // The ground preview of the held technique (§8.2) for the renderer: the aim, its reach, the
  // target of rule A and whether the finger is over «Отмена».
  previewOf(player, game, forward, contact) {
    const finger = [...this.fingers.values()].find(item => item.mode === 'pending' || item.mode === 'aim');
    const plan = finger && game && techniquePlan(game, finger.slot);
    if (!plan) return null;
    const button = this.layout.buttons[finger.slot];
    if (finger.mode === 'aim') {
      const aim = manualAim(finger.x - button.x, finger.y - button.y, plan.reach, this.rules.aimRadius * this.layout.u);
      return { slot: finger.slot, skill: plan.skill, mode: 'manual', aimX: aim?.[0] ?? forward[0], aimY: aim?.[1] ?? forward[1],
        ...plan.reach, target: null, cancel: finger.cancel };
    }
    const target = autoAimTarget(player, game.enemies, { forward, reach: plan.reach.max, contact, rules: this.rules });
    const [aimX, aimY] = target ? toward(player, target) : this.heading(forward, plan.reach);
    return { slot: finger.slot, skill: plan.skill, mode: 'auto', aimX, aimY, ...plan.reach, target, cancel: false };
  }

  // The aim of one cast: the drag, rule A, or F for a technique without an aim.
  castAim(entry, player, game, forward, contact) {
    const plan = game && techniquePlan(game, entry.action.slice(5));
    if (entry.aim === 'manual' && plan) {
      const aim = manualAim(entry.dx, entry.dy, plan.reach, this.rules.aimRadius * this.layout.u);
      if (aim) return aim;
    }
    if (!plan) return unit(...forward) ?? [0, 1];
    const target = autoAimTarget(player, game.enemies, { forward, reach: plan.reach.max, contact, rules: this.rules });
    return target ? toward(player, target) : this.heading(forward, plan.reach);
  }

  // Along F at headingReach, kept within the technique's reach.
  heading(forward, { min, max }) {
    const [fx, fy] = unit(...forward) ?? [0, 1], reach = clamp(this.rules.headingReach, min, max);
    return [fx * reach, fy * reach];
  }
}

// The aimed technique in a slot and its reach, whatever its cooldown or spirit: a refused cast
// still faces its aim. null for a combo, a dash, an empty slot or a technique without an aim.
function techniquePlan(game, slot) {
  const skill = game.loadout?.slots[slot] ?? null;
  const reach = skill && techniqueReach(skill, skillParams(game, skill));
  return reach ? { skill, reach } : null;
}
