export class Input {
  constructor(canvas, renderer, isActive) {
    this.keys = new Set(); this.attack = false; this.pointer = null; this.actions = [];
    this.canvas = canvas; this.renderer = renderer;
    const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyQ', 'KeyE'];
    window.addEventListener('keydown', e => {
      if (!isActive() || e.ctrlKey || e.metaKey || e.altKey) return;
      for (let target = e.target; target && target !== canvas; target = target.parentElement) {
        if (/^(BUTTON|INPUT|TEXTAREA|SELECT|A|SUMMARY)$/.test(target.tagName) || target.isContentEditable) return;
      }
      if (movementKeys.includes(e.code)) e.preventDefault();
      const firstPress = !e.repeat && !this.keys.has(e.code);
      this.keys.add(e.code);
      if (firstPress && e.code === 'Space') this.actions.push('dash');
      if (firstPress && e.code === 'KeyQ') this.actions.push('wave');
      if (firstPress && e.code === 'KeyE') this.actions.push('interact');
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('pointerup', e => { if (e.button === 0) this.attack = false; });
    window.addEventListener('pointercancel', () => this.clear());
    canvas.addEventListener('pointermove', e => { this.pointer = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerdown', e => {
      if (!isActive() || e.pointerType === 'touch') return;
      e.preventDefault(); canvas.focus();
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.attack = true;
      if (e.button === 2) this.actions.push('wave');
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
