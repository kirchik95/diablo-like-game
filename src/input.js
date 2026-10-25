import { SLOTS } from './skills.js';
import { physicalCode } from './key-codes.js';

// Technique slots (§2.1): RMB, Q and F queue 'slot:<id>'; main.js casts the loadout's skill with useSlot.
const techniqueSlots = SLOTS.filter(slot => slot.accepts === 'technique');
const SLOT_KEYS = Object.fromEntries(techniqueSlots.filter(slot => slot.code).map(slot => [slot.code, slot.id]));
const SLOT_BUTTONS = Object.fromEntries(techniqueSlots.filter(slot => slot.button !== undefined).map(slot => [slot.button, slot.id]));
// The «Монах» panel (§2.1, §5.5): C, I and K open its tabs, Tab opens the last one. main.js opens it with 'panel:<tab>'.
const PANEL_KEYS = { KeyC: 'panel:character', KeyI: 'panel:gear', KeyK: 'panel:skills', Tab: 'panel:next' };

export class Input {
  constructor(canvas, renderer, isActive) {
    this.keys = new Set(); this.attack = false; this.pointer = null; this.actions = [];
    this.canvas = canvas; this.renderer = renderer;
    const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyQ', 'KeyF', 'KeyE'];
    window.addEventListener('keydown', e => {
      if (!isActive() || e.ctrlKey || e.metaKey || e.altKey) return;
      for (let target = e.target; target && target !== canvas; target = target.parentElement) {
        if (/^(BUTTON|INPUT|TEXTAREA|SELECT|A|SUMMARY)$/.test(target.tagName) || target.isContentEditable) return;
      }
      const code = physicalCode(e);
      if (movementKeys.includes(code) || PANEL_KEYS[code]) e.preventDefault();
      const firstPress = !e.repeat && !this.keys.has(code);
      this.keys.add(code);
      if (firstPress && code === 'Space') this.actions.push('dash');
      if (firstPress && SLOT_KEYS[code]) this.actions.push(`slot:${SLOT_KEYS[code]}`);
      if (firstPress && code === 'KeyE') this.actions.push('interact');
      if (firstPress && PANEL_KEYS[code]) this.actions.push(PANEL_KEYS[code]);
    });
    window.addEventListener('keyup', e => { this.keys.delete(physicalCode(e)); this.keys.delete(e.code); });
    // A key released while the window is unfocused never sends keyup; drop held keys then.
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerup', e => { if (e.button === 0) this.attack = false; });
    window.addEventListener('pointercancel', () => this.clear());
    // A finger never aims like the mouse: touch.js owns touches and aims by rule A.
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      this.pointer ??= { x: 0, y: 0 };
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
    }, { passive: true });
    canvas.addEventListener('pointerdown', e => {
      if (!isActive() || e.pointerType === 'touch') return;
      e.preventDefault(); canvas.focus();
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.attack = true;
      if (SLOT_BUTTONS[e.button]) this.actions.push(`slot:${SLOT_BUTTONS[e.button]}`);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  clear() { this.keys.clear(); this.actions.length = 0; this.attack = false; this.pointer = null; }
  sample(player) {
    const pressed = (...keys) => keys.some(k => this.keys.has(k)) ? 1 : 0;
    const horizontal = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft');
    const vertical = pressed('KeyS', 'ArrowDown') - pressed('KeyW', 'ArrowUp');
    const moveX = (vertical - horizontal) * Math.SQRT1_2;
    const moveY = (vertical + horizontal) * Math.SQRT1_2;
    const target = this.pointer ? this.renderer.screenToWorld(this.pointer.x, this.pointer.y) : null;
    const moving = Math.hypot(moveX, moveY) > .001;
    const aimX = target ? target.x - player.x : moving ? moveX : player.dx;
    const aimY = target ? target.y - player.y : moving ? moveY : player.dy;
    const actions = this.actions.splice(0);
    return { moveX, moveY, aimX, aimY, attack: this.attack, actions };
  }
}
