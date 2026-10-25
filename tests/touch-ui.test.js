import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { createAdventure } from '../src/game.js';
import { gainXp } from '../src/run-progress.js';
import { TOUCH_RULES, TouchInput, touchLayout } from '../src/touch.js';

// touch-ui.js imports its stylesheet for Vite. Node has no CSS loader: the test loads it as an empty module.
const CSS_STUB = 'export default "";';
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: CSS_STUB, shortCircuit: true } : next(url, context),
  });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: ${JSON.stringify(CSS_STUB)}, shortCircuit: true } : next(url, context);
  }`)}`);
}
const { TouchUI, enterFullscreen, isIos, isStandalone, promptVerb, orbRows, orbArt, ORB_ROWS } = await import('../src/touch-ui.js');
const { KEYBOARD_KEYS, TOUCH_KEYS, controlKeys, slotKey } = await import('../src/gamepad.js');

// A small DOM: elements, classes, attributes, closest() over tag, class and role selectors.
// Inline style keeps plain properties; custom properties go through setProperty, as in the browser.
class FakeStyle {
  setProperty(name, value) { this[name] = String(value); }
  getPropertyValue(name) { return this[name] ?? ''; }
}
class FakeElement extends EventTarget {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: {}, style: new FakeStyle(),
      hidden: false, textContent: '', innerHTML: '', classes: new Set() });
    const classes = this.classes;
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, on = !classes.has(name)) => { if (on) classes.add(name); else classes.delete(name); return on; },
      contains: name => classes.has(name),
    };
  }
  set className(value) { this.classes.clear(); for (const name of String(value).split(/\s+/).filter(Boolean)) this.classes.add(name); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'hidden') this.hidden = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  prepend(...children) { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
  click() { this.dispatchEvent(new Event('click')); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  matches(selector) {
    return selector.split(',').map(part => part.trim()).some(part => {
      const role = /^\[role="([^"]+)"\]$/.exec(part), name = /^\.([\w-]+)$/.exec(part);
      return role ? this.attributes.role === role[1] : name ? this.classes.has(name[1]) : part.toUpperCase() === this.tagName;
    });
  }
  closest(selector) { for (let item = this; item; item = item.parentElement) if (item.matches?.(selector)) return item; return null; }
  *walk() { yield this; for (const child of this.children) yield* child.walk(); }
  find(className) { for (const item of this.walk()) if (item.classes.has(className)) return item; return null; }
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// visual stands for window.visualViewport: { width, height, offsetLeft, offsetTop }, an EventTarget.
function page({ coarse = true, ua = IPHONE_UA, width = 844, height = 390, safe = { top: 0, right: 47, bottom: 21, left: 47 },
  standalone = false, game = null, visual = null, pixelRatio } = {}) {
  const ids = new Map();
  const doc = Object.assign(new EventTarget(), {
    hidden: false, body: new FakeElement('body'), documentElement: new FakeElement('html'),
    createElement: tag => new FakeElement(tag), getElementById: id => ids.get(id) ?? null,
  });
  const pauseControls = new FakeElement('div');
  ids.set('pause-controls', pauseControls);
  const canvas = new FakeElement('canvas');
  doc.body.append(canvas);
  const calls = { fullscreen: [], lock: [], pause: 0, screens: [] };
  doc.documentElement.requestFullscreen = options => { calls.fullscreen.push(options); doc.fullscreenElement = doc.documentElement; return Promise.resolve(); };
  const win = Object.assign(new EventTarget(), {
    innerWidth: width, innerHeight: height, devicePixelRatio: pixelRatio,
    visualViewport: visual && Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, ...visual }),
    navigator: { userAgent: ua, platform: ua.includes('iPhone') ? 'iPhone' : 'Linux', maxTouchPoints: coarse ? 5 : 0 },
    screen: { orientation: { lock: orientation => { calls.lock.push(orientation); return Promise.resolve(); } } },
    matchMedia: query => ({ matches: query === '(pointer: coarse)' ? coarse : query.includes('display-mode') ? standalone : false }),
    getComputedStyle: element => element.classes?.has('touch-safe')
      ? { paddingTop: `${safe.top}px`, paddingRight: `${safe.right}px`, paddingBottom: `${safe.bottom}px`, paddingLeft: `${safe.left}px` }
      : { getPropertyValue: name => name === '--u' ? ' 2px' : '' },
  });
  const run = game ?? createAdventure({}, { seed: 7 });
  const touch = new TouchInput({ getGame: () => run });
  const ui = new TouchUI({ touch, doc, win, getGame: () => run,
    onPause: () => { calls.pause++; }, onScreen: state => calls.screens.push(state) });
  const pointer = (type, { id = 1, x = 0, y = 0, kind = 'touch', target = canvas } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: id, clientX: x, clientY: y, pointerType: kind });
    Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event);
    return event;
  };
  const resize = (w, h) => { win.innerWidth = w; win.innerHeight = h; win.dispatchEvent(new Event('resize')); };
  return { doc, win, ui, touch, game: run, canvas, pointer, resize, calls, pauseControls };
}
const level = (n, seed = 7) => {
  const game = createAdventure({}, { seed });
  const xp = [0, 80, 220, 450, 840, 1510][n - 1];
  if (xp) gainXp(game, xp);
  game.events.length = 0;
  return game;
};

test('a mouse-only desktop never gets the touch layer', () => {
  const { ui, doc, pointer } = page({ coarse: false, ua: DESKTOP_UA });
  ui.attach();
  pointer('pointerdown', { kind: 'mouse', x: 200, y: 250 });
  pointer('pointerdown', { kind: 'pen', x: 200, y: 250 });
  assert.equal(ui.active, false);
  assert.equal(doc.documentElement.classList.contains('touch-ui'), false);
  assert.equal(doc.body.children.length, 1, 'only the canvas');
});

test('a coarse pointer starts the layer at once; a fine one waits for the first touch, which already counts', () => {
  const phone = page();
  phone.ui.attach();
  assert.equal(phone.ui.active, true);
  assert.equal(phone.doc.documentElement.classList.contains('touch-ui'), true);
  assert.equal(phone.doc.body.children.filter(child => child.className === 'touch-layer').length, 1);
  // The screens stand outside the layer, so the pause menu (z 7) never covers them.
  assert.equal(phone.ui.parts.rotate.parentElement, phone.doc.body);
  const laptop = page({ coarse: false, ua: DESKTOP_UA });
  laptop.ui.attach();
  assert.equal(laptop.ui.active, false);
  laptop.pointer('pointerdown', { x: 200, y: 250 });
  assert.equal(laptop.ui.active, true);
  assert.equal(laptop.touch.stickView.held, true, 'the first touch drives the stick');
});

test('the drawn cluster sits where TouchInput hit-tests it, at the board 01 positions', () => {
  const { ui, touch } = page();
  ui.attach();
  const layout = touchLayout({ width: 844, height: 390, safe: { top: 0, right: 47, bottom: 21, left: 47 } });
  assert.deepEqual(touch.layout, layout);
  const corner = slot => [ui.slots[slot].style.left, ui.slots[slot].style.top];
  assert.deepEqual(corner('lmb'), ['691px', '257px']);
  assert.deepEqual(corner('space'), ['603px', '305px']);
  assert.deepEqual(corner('q'), ['655px', '161px']);
  assert.deepEqual(corner('f'), ['731px', '177px']);
  assert.deepEqual(corner('rmb'), ['603px', '229px']);
  const cancel = ui.parts.cancel.style;
  assert.deepEqual([cancel.left, cancel.top, cancel.width, cancel.height], ['709px', '92px', '80px', '44px']);
  const interact = ui.parts.interact.style;
  assert.deepEqual([interact.right, interact.bottom], ['253px', '29px'], '«E»: 6u left of «Шаг», on its bottom');
  const stick = ui.parts;
  assert.deepEqual([stick.stickBase.style.left, stick.stickBase.style.top], ['95px', '233px'], 'the resting stick centre 147, 285');
  assert.equal(stick.stick.classList.contains('held'), false);
});

test('slot states follow the run: ready, cost, cooldown, low spirit, locked «ур. N», new, series pips', () => {
  const { ui, game } = page({ game: level(1) });
  ui.attach();
  const own = ui.slotParts;
  assert.match(own.rmb.icon.innerHTML, /#icon-wave/);
  assert.equal(own.rmb.cost.textContent, '40');
  assert.equal(ui.slots.rmb.classList.contains('insufficient'), false);
  assert.match(own.space.icon.innerHTML, /#icon-dash/);
  assert.equal(own.space.cost.textContent, '', 'the dash is free');
  for (const [slot, text] of [['q', 'ур. 2'], ['f', 'ур. 4']]) {
    assert.equal(ui.slots[slot].classList.contains('locked'), true, slot);
    assert.equal(own[slot].unlock.textContent, text);
  }
  game.player.spirit = 10;
  game.player.waveCooldown = .6;
  game.player.attack = { index: 1 };
  ui.update(game, { newSkills: new Set(['wave']) });
  assert.equal(ui.slots.rmb.classList.contains('insufficient'), true);
  assert.equal(own.rmb.cooldown.textContent, '0.6');
  assert.equal(own.rmb.shade.style.getPropertyValue('--shade'), '0.5', 'the shade scales to half the well');
  assert.equal(ui.slots.rmb.classList.contains('new'), true);
  const pips = ui.parts.comboPips.children;
  assert.deepEqual(pips.map(pip => pip.classList.contains('on')), [true, true, false], 'bare hands: three strikes, the second running');
  assert.equal(ui.parts.chargePips.hidden, true, 'one dash charge draws no pips');
  // Level 4: the palm on 2 and the crane on 3.
  const later = page({ game: level(4) });
  later.ui.attach();
  assert.match(later.ui.slotParts.q.icon.innerHTML, /#icon-palm/);
  assert.match(later.ui.slotParts.f.icon.innerHTML, /#icon-crane/);
  assert.equal(later.ui.slots.f.classList.contains('locked'), false);
});

test('touches route by target: the game reaches TouchInput, buttons and dialogs keep theirs, the mouse is ignored', () => {
  const { ui, touch, pointer, canvas } = page();
  ui.attach();
  const down = pointer('pointerdown', { id: 1, x: 200, y: 250 });
  assert.equal(down.defaultPrevented, true, 'an owned finger stops the emulated mouse and scrolling');
  assert.equal(ui.parts.stick.classList.contains('held'), true);
  assert.deepEqual([ui.parts.stickBase.style.left, ui.parts.stickBase.style.top], ['148px', '198px']);
  pointer('pointermove', { id: 1, x: 220, y: 250 });
  assert.equal(ui.parts.stickKnob.style.left, '198px', 'the knob follows: 200 + 20 − 22');
  const dialog = new FakeElement('section');
  dialog.setAttribute('role', 'dialog');
  const copy = new FakeElement('p');
  dialog.append(copy);
  canvas.parentElement.append(dialog);
  assert.equal(pointer('pointerdown', { id: 2, x: 731, y: 297, target: new FakeElement('button') }).defaultPrevented, false);
  assert.equal(pointer('pointerdown', { id: 3, x: 731, y: 297, target: copy }).defaultPrevented, false);
  assert.equal(pointer('pointerdown', { id: 4, x: 731, y: 297, kind: 'mouse' }).defaultPrevented, false);
  assert.equal(touch.attack, false);
  pointer('pointerdown', { id: 5, x: 731, y: 297 });
  assert.equal(touch.attack, true);
  assert.equal(ui.slots.lmb.classList.contains('pressed'), true, '«Удар» draws pressed (§7)');
  pointer('pointercancel', { id: 5 });
  assert.equal(touch.attack, false, 'pointercancel lets every finger go (§10.7)');
  assert.equal(ui.parts.stick.classList.contains('held'), false);
  assert.equal(ui.slots.lmb.classList.contains('pressed'), false);
});

test('iPhone Safari toolbars: the layer covers the visual viewport, follows its size and offset, and touches hit in its coordinates', () => {
  const safe = { top: 0, right: 47, bottom: 21, left: 47 };
  // The address bar covers 50 px of the 390 px layout viewport: innerHeight stays 390.
  const { ui, touch, win, pointer } = page({ height: 390, visual: { width: 844, height: 340 }, pixelRatio: 3, safe });
  ui.attach();
  const layer = ui.parts.layer.style;
  assert.deepEqual({ ...layer }, { left: '0px', top: '0px', width: '844px', height: '340px', right: 'auto', bottom: 'auto' });
  assert.deepEqual(touch.layout, touchLayout({ width: 844, height: 340, safe }), 'the thumbs sit above the toolbar');
  assert.equal(ui.compactLoot, true, '340 visible px: loot lines join the notices');
  // The toolbar hides: visualViewport resizes, the window does not.
  win.visualViewport.height = 390;
  win.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(layer.height, '390px');
  assert.deepEqual(touch.layout, touchLayout({ width: 844, height: 390, safe }));
  assert.equal(ui.compactLoot, false);
  // The visible part moves (a keyboard, a zoom): the layer moves with it, on whole device pixels as the world.
  Object.assign(win.visualViewport, { offsetLeft: 10, offsetTop: 12.4 });
  win.visualViewport.dispatchEvent(new Event('scroll'));
  const top = Math.round(12.4 * 3) / 3;
  assert.deepEqual([layer.left, layer.top], ['10px', `${top}px`]);
  pointer('pointerdown', { id: 1, x: 200 + 10, y: 250 + top });
  assert.deepEqual([ui.parts.stickBase.style.left, ui.parts.stickBase.style.top], ['148px', '198px'], 'the same stick as at offset 0');
  const lmb = touch.layout.buttons.lmb;
  pointer('pointerdown', { id: 2, x: lmb.x + 10, y: lmb.y + top });
  assert.equal(touch.attack, true, '«Удар» hits where it is drawn');
  // Without visualViewport the layer keeps its CSS inset: 0.
  const old = page();
  old.ui.attach();
  assert.deepEqual({ ...old.ui.parts.layer.style }, {});
});

test('a drag on the page cannot scroll, pull to refresh or pinch; the start panel and the «Монах» sheet still scroll', () => {
  const { ui, doc, win, canvas, pointer } = page();
  const fire = (type, target) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const scroller = className => {
    const panel = new FakeElement('section'), line = new FakeElement('p');
    panel.className = className;
    panel.append(line);
    doc.body.append(panel);
    return line;
  };
  const intro = scroller('intro-scroll'), monk = scroller('monk-content tab-gear');
  assert.equal(fire('touchmove', canvas), false, 'no layer yet: the page keeps its default');
  ui.attach();
  assert.equal(fire('touchmove', canvas), true, 'the field');
  assert.equal(fire('touchmove', doc.body), true, 'the dimmer around the panel');
  assert.equal(fire('touchmove', ui.parts.pause), true, 'a fight button');
  assert.equal(fire('touchmove', intro), false, 'the start and pause panel scrolls');
  assert.equal(fire('touchmove', monk), false, 'the «Монах» sheet scrolls');
  assert.equal(fire('gesturestart', canvas), true, 'no pinch zoom');
  assert.equal(pointer('pointermove', { id: 1, x: 200, y: 250 }).defaultPrevented, true);
  assert.equal(pointer('pointermove', { id: 1, x: 200, y: 250, target: monk }).defaultPrevented, false);
  assert.equal(pointer('pointermove', { id: 1, x: 200, y: 250, kind: 'mouse' }).defaultPrevented, false, 'the mouse is not touched');
});

test('an idle layer writes nothing: update() and render() skip unchanged text, attributes and styles', () => {
  const { ui, game } = page();
  ui.attach();
  ui.update(game);
  const writes = [];
  const watch = (target, key, label) => {
    let value = target[key];
    Object.defineProperty(target, key, { get: () => value, set: next => { writes.push(label); value = next; }, configurable: true });
  };
  const own = ui.orbs.health, rmb = ui.slotParts.rmb;
  watch(own.value, 'textContent', 'orb value');
  watch(own.max, 'textContent', 'orb max');
  watch(ui.parts.stickBase.style, 'left', 'stick left');
  watch(ui.parts.stickKnob.style, 'top', 'knob top');
  watch(rmb.cooldown, 'textContent', 'cooldown');
  watch(rmb.shade.style, '--shade', 'shade');
  watch(rmb.cost, 'textContent', 'cost');
  watch(ui.parts.interact, 'hidden', 'interact');
  watch(ui.parts.monkDot, 'hidden', 'dot');
  const setAttribute = own.element.setAttribute;
  own.element.setAttribute = (...args) => { writes.push(`aria ${args[0]}`); setAttribute.apply(own.element, args); };
  ui.update(game);
  ui.update(game);
  ui.render();
  assert.deepEqual(writes, []);
  game.player.hp -= 10;
  ui.update(game);
  assert.deepEqual(writes, ['aria aria-valuenow', 'orb value'], 'a hit writes the health number only');
});

test('the aim circle and «Отмена» show only in aim mode; «Отмена» turns coral under the finger', () => {
  const { ui, pointer } = page({ game: level(2) });
  ui.attach();
  pointer('pointerdown', { id: 1, x: 683, y: 189 });
  assert.equal(ui.parts.aim.hidden, true, 'pressed, not yet aiming');
  assert.equal(ui.slots.q.classList.contains('pressed'), true);
  pointer('pointermove', { id: 1, x: 683, y: 177 });
  assert.equal(ui.parts.aim.hidden, false);
  assert.equal(ui.parts.cancel.hidden, false);
  assert.deepEqual([ui.parts.aimCircle.style.left, ui.parts.aimCircle.style.top], ['611px', '117px'], 'the 36u circle of board 05');
  assert.equal(ui.parts.aimLine.style.width, '12px');
  pointer('pointermove', { id: 1, x: 749, y: 114 });
  assert.equal(ui.parts.cancel.classList.contains('over'), true);
  assert.equal(ui.parts.aimLine.hidden, true, 'the line goes out over «Отмена»');
  pointer('pointerup', { id: 1, x: 749, y: 114 });
  assert.equal(ui.parts.aim.hidden, true);
  assert.equal(ui.parts.cancel.hidden, true);
  assert.equal(ui.slots.q.classList.contains('pressed'), false);
});

test('«E» shows the verb and acts on the touch; «Монах» opens the last tab; «Пауза» pauses; the dot marks news', () => {
  const { ui, touch, game, calls } = page({ game: level(1) });
  ui.attach();
  assert.equal(ui.parts.interact.hidden, true, 'nothing to do here');
  Object.assign(game.player, { x: game.world.secret.x, y: game.world.secret.y });
  ui.update();
  assert.equal(ui.parts.interact.hidden, false);
  assert.equal(ui.parts.interactCopy.textContent, 'Открыть тайник', 'no key names on the phone (§5)');
  const tap = button => {
    const event = new Event('pointerdown', { cancelable: true });
    button.dispatchEvent(event);
    return event;
  };
  assert.equal(tap(ui.parts.interact).defaultPrevented, true);
  assert.equal(ui.parts.interact.classList.contains('pressed'), true);
  ui.parts.interact.dispatchEvent(new Event('pointerup'));
  assert.equal(ui.parts.interact.classList.contains('pressed'), false);
  tap(ui.parts.monk);
  assert.deepEqual(touch.sample(game.player, undefined, game).actions, ['interact', 'panel:next']);
  tap(ui.parts.pause);
  assert.equal(calls.pause, 1);
  const click = Object.assign(new Event('click'), { detail: 0 });
  ui.parts.pause.dispatchEvent(click);
  assert.equal(calls.pause, 2, 'a keyboard click works too');
  ui.parts.pause.dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
  assert.equal(calls.pause, 2, 'the click after a touch does not pause twice');
  assert.equal(ui.parts.monkDot.hidden, true);
  ui.update(game, { newItems: 1 });
  assert.equal(ui.parts.monkDot.hidden, false, 'a new item');
  const leveled = page({ game: level(2) });
  leveled.ui.attach();
  assert.equal(leveled.ui.parts.monkDot.hidden, false, 'an unspent path point');
  assert.equal(promptVerb('E — взять припасы'), 'Взять припасы');
  assert.equal(promptVerb(''), '');
});

test('a turn to portrait shows «Поверни телефон», pauses and lets every finger go; the turn back keeps the pause', () => {
  const { ui, touch, pointer, resize, calls } = page();
  ui.attach();
  assert.deepEqual(calls.screens, ['play']);
  pointer('pointerdown', { id: 1, x: 200, y: 250 });
  assert.equal(touch.stickView.held, true);
  resize(390, 844);
  assert.equal(ui.parts.rotate.hidden, false);
  assert.equal(calls.pause, 1);
  assert.equal(touch.stickView.held, false, 'the stick let go');
  resize(844, 390);
  assert.equal(ui.parts.rotate.hidden, true);
  assert.equal(calls.pause, 1, 'the turn back does not resume or pause again (§11.3)');
  resize(560, 320);
  assert.equal(ui.parts.small.hidden, false, '«Экран слишком мал» below 568×320');
  assert.equal(calls.pause, 2);
  assert.deepEqual(calls.screens, ['play', 'rotate', 'play', 'small']);
});

test('main.js may not start or resume the run under «Поверни телефон» or «Экран слишком мал»', () => {
  const { ui, resize } = page({ width: 390, height: 844 });
  assert.equal(ui.blocked, false, 'no layer, no block');
  ui.attach();
  assert.equal(ui.blocked, true, 'a page opened in portrait');
  resize(844, 390);
  assert.equal(ui.blocked, false);
  resize(560, 320);
  assert.equal(ui.blocked, true, 'too small');
  resize(915, 412);
  assert.equal(ui.blocked, false);
});

test('iPhone Safari gets the home-screen hint in the pause menu; Android goes full screen after the first touch', async () => {
  const iphone = page();
  iphone.ui.attach();
  assert.equal(isIos(iphone.win.navigator), true);
  const hint = iphone.pauseControls.children.at(-1);
  assert.equal(hint?.className, 'touch-home-hint');
  assert.equal(hint.children[0].textContent, 'На экран «Домой»');
  iphone.pointer('pointerdown', { id: 1, x: 200, y: 250 });
  iphone.pointer('pointerup', { id: 1, x: 200, y: 250 });
  assert.deepEqual(iphone.calls.fullscreen, [], 'iPhone Safari has no full screen');
  const installed = page({ standalone: true });
  installed.ui.attach();
  assert.equal(isStandalone(installed.win), true);
  const hasHint = controls => controls.children.some(child => child.className === 'touch-home-hint');
  assert.equal(hasHint(installed.pauseControls), false, 'already on the home screen');
  const android = page({ ua: ANDROID_UA, safe: { top: 0, right: 0, bottom: 16, left: 32 }, width: 915, height: 412 });
  android.ui.attach();
  assert.equal(hasHint(android.pauseControls), false);
  android.pointer('pointerdown', { id: 1, x: 200, y: 250 });
  assert.deepEqual(android.calls.fullscreen, [], 'a touch pointerdown is not a user activation');
  android.pointer('pointerup', { id: 1, x: 200, y: 250 });
  assert.deepEqual(android.calls.fullscreen, [{ navigationUI: 'hide' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(android.calls.lock, ['landscape']);
  android.pointer('pointerdown', { id: 2, x: 200, y: 250 });
  android.pointer('pointerup', { id: 2, x: 200, y: 250 });
  assert.equal(android.calls.fullscreen.length, 1, 'once');
  // A browser that refuses keeps playing: the promise settles false.
  const doc = { documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } };
  assert.equal(await enterFullscreen(doc, {}), false);
  assert.equal(await enterFullscreen({ documentElement: {} }, {}), false, 'no API at all');
});

test('mobile.css styles only the touch layer: every rule is scoped to html.touch-ui or a touch- class', () => {
  const css = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // At-rules and keyframe steps hold rules; the rules inside them are checked on their own.
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim())
    .filter(head => !head.startsWith('@') && !/^(from|to|\d+%)$/.test(head)).flatMap(head => head.split(/,(?![^(]*\))/)).map(item => item.trim());
  assert.ok(selectors.length > 40);
  for (const selector of selectors) {
    assert.match(selector, /^(html\.touch-ui\b|\.touch-|body\.menu-open \.touch-)/, selector);
  }
  // Colours are the palette tokens of styles.css or their alpha forms (§1: the style stays).
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const palette = new Set([...styles.matchAll(/--[\w-]+:\s*(#[0-9a-f]{6})/gi)].map(match => match[1].toLowerCase()));
  for (const [hex] of css.matchAll(/#[0-9a-f]{6,8}\b/gi)) {
    const base = hex.slice(0, 7).toLowerCase();
    assert.ok(palette.has(base) || ['#1a1523', '#130f1b', '#453846', '#3c3033'].includes(base), `${hex} is not a palette colour`);
  }
});

test('iPhone Safari: no page pan, rubber band, pull to refresh or focus zoom; the two scrollers keep pan-y', () => {
  const strip = file => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const mobile = strip('../src/mobile.css'), styles = strip('../src/styles.css');
  const rule = (css, selector) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, head]) => head.split(/,(?![^(]*\))/).map(item => item.trim()).includes(selector)).map(([, , body]) => body).join(';');
  // The visible height, not the one under the toolbar (§2.3).
  assert.match(rule(styles, 'body'), /height: 100%;\s*height: 100dvh;/);
  assert.match(rule(styles, 'html'), /overscroll-behavior: none/);
  for (const selector of ['html.touch-ui', 'html.touch-ui body', 'html.touch-ui .overlay', '.touch-interact', '.touch-system button']) {
    assert.match(rule(mobile, selector), /touch-action: none/, selector);
  }
  assert.match(rule(mobile, 'html.touch-ui body'), /overscroll-behavior: none/);
  for (const selector of ['html.touch-ui .intro-scroll', 'html.touch-ui .monk-content']) {
    assert.match(rule(mobile, selector), /overscroll-behavior: contain;[^;]*touch-action: pan-y/, selector);
  }
  assert.match(rule(mobile, 'html.touch-ui .appearance-choice input'), /font-size: 16px/);
});

test('the 29u orbs fill whole rows: round(21 × value / max), one row above 0, the light row only below the brim', () => {
  assert.equal(ORB_ROWS, 21);
  assert.deepEqual([[0, 116], [1, 116], [58, 116], [116, 116], [200, 116], [5, 0]].map(([value, max]) => orbRows(value, max)),
    [0, 1, 11, 21, 21, 0]);
  const rows = rows => /<clipPath id="touch-health-level"><rect x="0" y="(\d+)" width="29" height="(\d+)"/.exec(orbArt('health', rows)).slice(1).map(Number);
  assert.deepEqual(rows(21), [4, 21], 'full glass: rows 4 to 24');
  assert.deepEqual(rows(1), [24, 1]);
  const surface = art => Number(/class="orb-surface" x="0" y="\d+" width="29" height="(\d)"/.exec(art)[1]);
  assert.deepEqual([0, 1, 20, 21].map(n => surface(orbArt('spirit', n))), [0, 1, 1, 0]);
  const { ui, game } = page({ game: level(1) });
  ui.attach();
  const health = ui.orbs.health, spirit = ui.orbs.spirit;
  assert.equal(health.value.textContent, String(game.player.hp));
  assert.equal(health.max.textContent, ` / ${game.player.maxHp}`);
  assert.equal(spirit.value.textContent, '60', 'the run starts with 60 spirit');
  game.player.hp = 20.4; game.player.spirit = .5;
  ui.update();
  assert.equal(health.value.textContent, '21', 'a living monk never reads 0');
  assert.equal(health.element.classList.contains('low'), true);
  assert.equal(spirit.value.textContent, '0');
  assert.equal(spirit.element.classList.contains('drained'), true);
  assert.equal(health.element.getAttribute('aria-valuenow'), '21');
  const art = health.art.innerHTML;
  ui.update();
  assert.equal(health.art.innerHTML, art, 'the same rows keep the drawing');
});

test('Android «назад»: a touch arms one history entry; «назад» spends it on the panel or the pause, never on the page', () => {
  const { ui, win, pointer } = page({ ua: ANDROID_UA });
  const pushed = [], backs = [];
  win.history = { pushState: state => pushed.push(state) };
  ui.onBack = () => backs.push('back');
  ui.attach();
  assert.deepEqual(pushed, [], 'no entry without a user gesture: Chrome would skip it');
  pointer('pointerdown', { id: 1, x: 200, y: 250 });
  pointer('pointerup', { id: 1, x: 200, y: 250 });
  pointer('pointerdown', { id: 2, x: 200, y: 250 });
  pointer('pointerup', { id: 2, x: 200, y: 250 });
  assert.equal(pushed.length, 1, 'one entry at a time');
  win.dispatchEvent(new Event('popstate'));
  assert.deepEqual(backs, ['back']);
  win.dispatchEvent(new Event('popstate'));
  assert.deepEqual(backs, ['back'], 'a second «назад» without a new touch leaves the page');
  pointer('pointerdown', { id: 3, x: 200, y: 250, target: new FakeElement('button') });
  pointer('pointerup', { id: 3, x: 200, y: 250 });
  assert.equal(pushed.length, 2, 'a touch on a menu button arms it again');
});

test('the pause menu gets «Карта» (the sound is a switch in «Настройки»); the map opens over the menu and a tap beside it closes it', () => {
  const { ui, doc, win, pauseControls } = page();
  doc.getElementById = id => ({ 'pause-controls': pauseControls })[id] ?? null;
  let resizes = 0;
  win.addEventListener('resize', () => resizes++);
  ui.attach();
  const tools = pauseControls.children[0];
  assert.equal(tools.className, 'touch-tools', 'first in the legend: its last paragraph keeps the tips row');
  assert.deepEqual(tools.children.map(button => button.textContent), ['Карта']);
  assert.equal(ui.parts.soundButton, undefined, 'one sound switch for every device: #sound in «Настройки»');
  resizes = 0;
  ui.parts.mapButton.click();
  assert.equal(doc.body.classList.contains('touch-map'), true);
  assert.equal(resizes, 1, 'main.js refits the minimap on resize');
  assert.equal(ui.parts.mapButton.getAttribute('aria-pressed'), 'true');
  ui.parts.mapClose.click();
  assert.equal(doc.body.classList.contains('touch-map'), false);
  ui.parts.mapButton.click();
  ui.release();
  assert.equal(doc.body.classList.contains('touch-map'), false, 'leaving the menu closes the map');
});

test('loot lines join the notices below 380 px; the renderer gets the aim view only while touch is the device', () => {
  const { ui, touch, resize, pointer } = page();
  assert.equal(ui.compactLoot, false);
  assert.equal(ui.aimView(), null, 'no layer, no touch aim');
  ui.attach();
  assert.equal(ui.compactLoot, false, '390 px high');
  resize(844, 360);
  assert.equal(ui.compactLoot, true);
  assert.equal(ui.aimView(), null, 'the keyboard is still the device in use');
  pointer('pointerdown', { id: 1, x: 200, y: 250 });
  assert.equal(touch.device, 'touch');
  assert.deepEqual(ui.aimView(), { preview: touch.preview, markedTarget: touch.markedTarget });
});

test('a long panel scrolls inside its stone frame: the frame box never scrolls, the text box does', () => {
  const strip = file => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const styles = strip('../src/styles.css'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const rule = selector => styles.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  // .intro-panel::before is the frame (absolute, inset 0): a scrolling .intro-panel would move it with the text.
  assert.match(styles, /\.intro-panel::before,[^{]*\{[^}]*position: absolute;[^}]*inset: 0;/);
  assert.doesNotMatch(rule('.intro-panel'), /overflow/);
  assert.match(rule('.intro-panel'), /display: flex;\s*flex-direction: column;[^}]*max-height: 100%;/);
  assert.match(rule('.intro-scroll'), /min-height: 0; overflow: auto;/);
  // Every block of the panel sits in the one text box.
  const start = html.indexOf('<section class="intro-panel"'), panel = html.slice(start, html.indexOf('</section>', start));
  assert.deepEqual([...panel.matchAll(/^ {8}<(\w+)[^>]*>/gm)].map(match => match[0].trim()), ['<div class="intro-scroll">']);
});

test('the phone start screen keeps «Начать путь» beside the look picker, in two columns that fit 844×390 (§14)', () => {
  const css = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = 'html.touch-ui .intro-scroll:has(> #appearance-picker:not([hidden]))';
  const rule = selector => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, selector);
    return match[1];
  };
  // Only the start screen shows the picker, so pause and end screens keep one column.
  const panel = rule(start);
  assert.match(panel, /display: grid;/);
  assert.match(panel, /grid-template-columns: minmax\(calc\(var\(--u\) \* 120\), 1fr\) auto;/);
  assert.match(panel, /grid-template-rows: repeat\(5, auto\) 1fr repeat\(3, auto\);/);
  // The panel is at most 384u = 768 px: it fits 844 px between two 8 px edges, and 100% inside the iPhone notch.
  const width = rule('html.touch-ui .intro-panel:has(#appearance-picker:not([hidden]))');
  assert.ok(Number(width.match(/width: min\(calc\(var\(--u\) \* (\d+)\), 100%\);/)[1]) * TOUCH_RULES.u <= 844 - 2 * 8);
  assert.match(rule(`${start} > *`), /grid-column: 1;/);
  // The button, «Начать заново» and the hint sit in the last three rows, under the 1fr row that a taller picker fills.
  assert.match(rule(`${start} > #play`), /grid-row: -4;/);
  assert.match(rule(`${start} > #restart`), /grid-row: -3;/);
  assert.match(rule(`${start} > .entry-hint`), /grid-row: -2;/);
  // The picker spans every row of the right column; «safe» keeps its top in the scroll on a 568×320 screen.
  assert.match(rule(`${start} > .appearance-picker`), /grid-column: 2; grid-row: 1 \/ -1; align-self: safe center; margin: 0;/);
  // The five auto rows above the 1fr row hold exactly the five blocks before the picker in index.html.
  const intro = html.slice(html.indexOf('<section class="intro-panel"'), html.indexOf('<div id="appearance-picker"'));
  assert.deepEqual([...intro.matchAll(/^ {10}<(\w+)[^>]*?(?:class|id)="([^"]+)"/gm)].map(match => match[2]),
    ['wordmark', 'eyebrow', 'panel-title', 'title-rule', 'panel-copy']);
});

test('the phone pause screen puts the legend beside «Продолжить», so the whole legend fits 844×390 without a scroll', () => {
  const css = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const pause = 'html.touch-ui .intro-scroll:has(> #pause-controls:not([hidden]))';
  const rule = selector => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, selector);
    return match[1];
  };
  const grid = rule(pause);
  assert.match(grid, /display: grid;/);
  assert.match(grid, /grid-template-columns: minmax\(calc\(var\(--u\) \* 112\), 1fr\) minmax\(0, 2fr\);/);
  // Seven auto rows hold the wordmark, the eyebrow, the title, the copy, «Продолжить», «Начать заново» and, on a
  // 568×320 screen, «Настройки»; the 1fr row under them takes the rest of the legend's height.
  assert.match(grid, /grid-template-rows: repeat\(7, auto\) 1fr;/);
  const width = rule('html.touch-ui .intro-panel:has(#pause-controls:not([hidden]))');
  assert.ok(Number(width.match(/width: min\(calc\(var\(--u\) \* (\d+)\), 100%\);/)[1]) * TOUCH_RULES.u <= 844 - 2 * 8);
  assert.match(rule(`${pause} > *`), /grid-column: 1;/);
  assert.match(rule(`${pause} > #restart`), /justify-self: start;/);
  // The legend spans every row of the right column and drops its desktop rule above.
  const legend = rule(`${pause} > #pause-controls`);
  assert.match(legend, /grid-column: 2;\s*grid-row: 1 \/ -1;\s*align-self: start;/);
  assert.match(legend, /margin-top: 0;\s*padding-top: 0;\s*border-top: 0;/);
  // From 592 px of panel content the switches stand at the free end of the legend's «Карта» row: the left column
  // keeps only the title and the buttons, and the two-row settings do not make the 844×390 menu scroll.
  assert.match(rule('html.touch-ui .intro-panel:has(#pause-controls:not([hidden]))'), /container: pause-menu \/ inline-size;/);
  const [, beside] = css.match(/@container pause-menu \(width >= 592px\) \{([\s\S]*?)\n\}/);
  const settings = beside.match(/> #pause-settings \{([^}]*)\}/)[1];
  assert.match(settings, /z-index: 1;\s*display: flex;\s*grid-column: 2;\s*grid-row: 1 \/ -1;\s*align-self: start;\s*justify-self: end;/);
  assert.match(beside, /#pause-settings h2 \{ position: absolute; width: 1px; height: 1px;[^}]*clip-path: inset\(50%\);/);
  // At the threshold the left column sits at its 112u minimum: the legend column keeps 592 − 224 − 16 = 352 px.
  // It needs two 30u switches, their 3u gaps and the 6u gap between rows, plus the text measured live at 2 px --u:
  // «Звук» and «Графика» 92 px, the «Карта» button 67 px.
  const u = TOUCH_RULES.u, legendColumn = 592 - 112 * u - 8 * u;
  assert.ok(legendColumn >= (2 * 30 + 2 * 3 + 6) * u + 92 + 67 + 3 * u, `${legendColumn} px for the «Карта» row`);
  // The «Карта» row is the legend's first row, as tall as a switch: both are 22u.
  assert.match(css, /\n\.touch-tool \{\s*height: calc\(var\(--u\) \* 22\);/);
  assert.match(css, /\nhtml\.touch-ui \.setting-switch \{ height: calc\(var\(--u\) \* 22\);/);
  // The legend comes last in index.html, so the reading order stays: title, buttons, settings, legend.
  const panel = html.slice(html.indexOf('<section class="intro-panel"'), html.indexOf('<div id="pause-controls"') + 30);
  assert.deepEqual([...panel.matchAll(/^ {10}<\w+[^>]*?id="([^"]+)"/gm)].map(match => match[1]).slice(-4), ['restart', 'entry-hint', 'pause-settings', 'pause-controls']);
});

test('the «Монах» sheet narrower than its three columns stacks them, so every slot and button fits 568×320', () => {
  const css = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const u = TOUCH_RULES.u, cells = value => Number(value);
  const rule = (source, selector) => {
    const match = source.match(new RegExp(`(?:^|\\n) *${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, selector);
    return match[1];
  };
  assert.match(rule(css, 'html.touch-ui .monk-panel'), /container: monk-sheet \/ inline-size;/);
  const [block, threshold] = css.match(/@container monk-sheet \(width < (\d+)px\) \{([\s\S]*?)\n\}/).slice(0, 3).reverse();
  // The wide columns: «Умения» 110 + 148 + 92 with two 3u gaps, «Снаряжение» 108 + 132 + 96 with two 8u gaps,
  // and the 3u scrollbar gap. The narrow layout starts exactly where the wider of the two stops fitting.
  const skills = rule(css, 'html.touch-ui .monk-content.tab-skills');
  const [skillList, skillText, skillSlots] = [...skills.matchAll(/calc\(var\(--u\) \* (\d+)\)/g)].map(match => cells(match[1]));
  const gear = rule(css, 'html.touch-ui .mp-gear-touch');
  const [gearLeft, gearCard, gearRight] = [...gear.matchAll(/calc\(var\(--u\) \* (\d+)\)/g)].map(match => cells(match[1]));
  const scrollGap = cells(rule(css, 'html.touch-ui .monk-content').match(/padding-right: calc\(var\(--u\) \* (\d+)\);/)[1]);
  const wide = Math.max(skillList + skillText + skillSlots + 2 * 3, gearLeft + gearCard + gearRight + 2 * 8) + scrollGap;
  assert.equal(Number(threshold), wide * u);
  // The smallest play screen: 568 px less the sheet's 8u side padding and the scrollbar gap.
  const sheetPad = cells(desktop.match(/\n\.monk-panel \{[^}]*?padding: calc\(var\(--u\) \* \d+\) calc\(var\(--u\) \* (\d+)\);/)[1]);
  const room = (568 - 2 * sheetPad * u) / u - scrollGap;
  assert.ok(Number(threshold) > 568 - 2 * sheetPad * u, '568×320 gets the narrow sheet');
  const narrow = (selector) => rule(block, selector);
  // «Снаряжение»: two columns, the chosen card keeps its wide width; every area is placed.
  const narrowGear = narrow('html.touch-ui .mp-gear-touch');
  assert.match(narrowGear, new RegExp(`grid-template-columns: calc\\(var\\(--u\\) \\* ${gearLeft}\\) minmax\\(0, 1fr\\);`));
  assert.ok(gearLeft + 8 + gearCard <= room, `${gearLeft} + 8 + ${gearCard} ≤ ${room}`);
  const areas = new Set(narrowGear.match(/grid-template-areas: ([^;]+);/)[1].match(/[a-z]+/g));
  const placed = new Set([...block.matchAll(/grid-area: ([a-z]+);/g)].map(match => match[1]));
  assert.deepEqual([...areas].sort(), [...placed].sort());
  assert.match(narrow('html.touch-ui .mp-gear-touch > .mp-gear-col > .mp-actions'), /grid-area: actions; flex-direction: row;/);
  // «Умения»: the list beside the slot buttons, which stay in view while the list scrolls.
  assert.match(narrow('html.touch-ui .monk-content.tab-skills'), new RegExp(`grid-template-columns: minmax\\(0, 1fr\\) calc\\(var\\(--u\\) \\* ${skillSlots}\\);`));
  assert.ok(skillList + 3 + skillSlots <= room);
  assert.match(narrow('html.touch-ui .tab-skills .mp-slots'), /grid-column: 2; grid-row: 2; position: sticky; top: 0;/);
  // Sticky slots are not held to their grid row: nothing else may use the column under them.
  const column2 = [...block.matchAll(/(html\.touch-ui [^{]+) \{[^}]*grid-column: (?:2|1 \/ -1|-1)[;\s]/g)].map(match => match[1].trim());
  assert.deepEqual(column2.filter(selector => selector.includes('tab-skills')), ['html.touch-ui .tab-skills .mp-slot-hint', 'html.touch-ui .tab-skills .mp-slots']);
  // «Персонаж»: the path with «Взять» first.
  assert.match(narrow('html.touch-ui .monk-content.tab-character > .mp-path'), /order: -1;/);
  const path = rule(css, 'html.touch-ui .monk-content.tab-character > .mp-path');
  assert.ok(cells(path.match(/grid-template-columns: calc\(var\(--u\) \* (\d+)\)/)[1]) + 6 + 96 <= room, 'the tree and a 96u column for «Взять»');
});

test('the touch labels cover every keyboard label and name slots 1, 2, 3 without keys (question 4)', () => {
  assert.deepEqual(Object.keys(KEYBOARD_KEYS).filter(key => !(key in TOUCH_KEYS)), []);
  assert.equal(controlKeys('touch'), TOUCH_KEYS);
  assert.deepEqual(['rmb', 'q', 'f'].map(slot => slotKey(TOUCH_KEYS, slot)), ['1', '2', '3']);
  for (const [key, label] of Object.entries(TOUCH_KEYS)) {
    if (key !== 'touch') assert.doesNotMatch(label, /^(ЛКМ|ПКМ|[A-Z]|Esc|Tab|ПРОБЕЛ)$/, key);
  }
});
