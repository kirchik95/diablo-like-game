import test from 'node:test';
import assert from 'node:assert/strict';
import * as appearance from '../src/appearance.js';
import { Input } from '../src/input.js';

test('appearance defaults malformed input and only replaces invalid choices', () => {
  assert.deepEqual(appearance.normalizeAppearance(), { skin: 'warm', hair: 'shaved', sash: 'wine' });
  for (const value of [null, 0, 'deep', [], { skin: 'unknown', hair: {}, sash: false }]) {
    assert.deepEqual(appearance.normalizeAppearance(value), { skin: 'warm', hair: 'shaved', sash: 'wine' });
  }
  assert.deepEqual(appearance.normalizeAppearance({ skin: 'deep', hair: 'invalid', sash: 'ochre' }), {
    skin: 'deep', hair: 'shaved', sash: 'ochre',
  });
});

test('appearance normalization isolates a chosen look from its caller and defaults', () => {
  const selected = { skin: 'pale', hair: 'short', sash: 'teal' };
  const normalized = appearance.normalizeAppearance(selected);
  normalized.skin = 'deep';
  assert.deepEqual(selected, { skin: 'pale', hair: 'short', sash: 'teal' });
  assert.deepEqual(appearance.normalizeAppearance(), { skin: 'warm', hair: 'shaved', sash: 'wine' });
});

test('every offered look resolves the matching atlas and preview without losing metadata', () => {
  const { skins, hair, sashes } = appearance.appearanceOptions;
  assert.deepEqual(skins.map(option => option.id), ['warm', 'deep', 'pale']);
  assert.deepEqual(hair.map(option => option.id), ['shaved', 'short']);
  assert.deepEqual(sashes.map(option => option.id), ['wine', 'teal', 'ochre']);
  const ids = new Set();
  for (const skin of ['warm', 'deep', 'pale']) {
    for (const hair of ['shaved', 'short']) {
      for (const sash of ['wine', 'teal', 'ochre']) {
        const result = appearance.appearanceVariant({ skin, hair, sash });
        const id = `${skin}-${hair}-${sash}`;
        assert.equal(result.id, id);
        assert.equal(result.path, `${id}.png`);
        assert.equal(result.previewPath, `${id}-preview.png`);
        assert.ok(new URL(result.url).pathname.endsWith(`/assets/game/pixel-v17/monk-side/appearance/${id}.png`));
        assert.ok(new URL(result.previewUrl).pathname.endsWith(`/assets/game/pixel-v3/appearance/${id}-preview.png`));
        assert.equal(result.skin, skin);
        assert.equal(result.hair, hair);
        assert.equal(result.sash, sash);
        ids.add(result.id);
      }
    }
  }
  assert.equal(ids.size, 18);
  assert.equal(appearance.appearanceVariant({ skin: 'missing', hair: 'short', sash: 'teal' }).id, 'warm-short-teal');
});

function inputFixture(t) {
  const priorWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  t.after(() => {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  });
  const canvas = new EventTarget();
  canvas.focus = () => {};
  let active = true;
  const input = new Input(canvas, { screenToWorld: (x, y) => ({ x, y }) }, () => active);
  const key = (type, code, modifiers = {}) => {
    const { target = canvas, ...properties } = modifiers;
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, repeat: false, ...properties });
    Object.defineProperty(event, 'target', { value: target });
    events.dispatchEvent(event);
    return event;
  };
  const sample = () => input.sample({ x: 0, y: 0, dx: 1, dy: 0 });
  return { input, canvas, key, sample, setActive: value => { active = value; } };
}

test('E queues one interaction per physical press and sampling drains the action', t => {
  const { key, sample } = inputFixture(t);
  assert.equal(key('keydown', 'KeyE').defaultPrevented, true);
  key('keydown', 'KeyE', { repeat: true });
  key('keydown', 'KeyE');
  assert.deepEqual(sample().actions, ['interact']);
  assert.deepEqual(sample().actions, []);
  key('keyup', 'KeyE');
  key('keydown', 'KeyE');
  assert.deepEqual(sample().actions, ['interact']);
});

test('pause and modifier shortcuts cannot queue interactions or leak an old action', t => {
  const { key, input, sample, setActive } = inputFixture(t);
  setActive(false);
  key('keydown', 'KeyE');
  assert.deepEqual(sample().actions, []);
  setActive(true);
  key('keydown', 'KeyE', { repeat: true });
  assert.deepEqual(sample().actions, []);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    key('keydown', 'KeyE', { [modifier]: true });
    key('keyup', 'KeyE');
  }
  assert.deepEqual(sample().actions, []);
  key('keydown', 'KeyE');
  input.clear();
  key('keydown', 'KeyE', { repeat: true });
  assert.deepEqual(sample().actions, []);
  key('keyup', 'KeyE');
  key('keydown', 'KeyE');
  assert.deepEqual(sample().actions, ['interact']);
});

test('E preserves movement, aiming and the existing combat actions', t => {
  const { key, sample } = inputFixture(t);
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  key('keydown', 'KeyQ');
  key('keydown', 'KeyE');
  const controls = sample();
  // Q is its own technique slot now; it no longer repeats the wave (§2.1).
  assert.deepEqual(controls.actions, ['dash', 'slot:q', 'interact']);
  assert.ok(controls.moveX < 0 && controls.moveY < 0);
  assert.ok(Math.abs(Math.hypot(controls.moveX, controls.moveY) - 1) < 1e-12);
  assert.equal(controls.aimX, controls.moveX);
  assert.equal(controls.aimY, controls.moveY);
});

test('clearing input on a portal or panel discards held attacks and the old pointer target', t => {
  const { input, canvas, key, sample } = inputFixture(t);
  const pointer = new Event('pointerdown', { cancelable: true });
  Object.assign(pointer, { clientX: 10, clientY: 20, button: 0, pointerType: 'mouse' });
  canvas.dispatchEvent(pointer);
  key('keydown', 'KeyW');
  key('keydown', 'KeyE');
  assert.equal(sample().attack, true);
  input.clear();
  const controls = sample();
  assert.equal(controls.attack, false);
  assert.deepEqual(controls.actions, []);
  assert.equal(Math.hypot(controls.moveX, controls.moveY), 0);
  assert.equal(controls.aimX, 1);
  assert.equal(controls.aimY, 0);
});

test('Space on HUD buttons keeps native activation and does not dash; canvas still dashes once', t => {
  const { key, sample, canvas } = inputFixture(t);
  for (const id of ['sound', 'pause']) {
    const button = { tagName: 'BUTTON', id };
    for (const target of [button, { tagName: 'svg', parentElement: button }]) {
      assert.equal(key('keydown', 'Space', { target }).defaultPrevented, false);
      assert.deepEqual(sample().actions, []);
      key('keyup', 'Space', { target });
    }
  }
  assert.equal(key('keydown', 'Space', { target: canvas }).defaultPrevented, true);
  key('keydown', 'Space', { target: canvas, repeat: true });
  assert.deepEqual(sample().actions, ['dash']);
  assert.deepEqual(sample().actions, []);
});

test('game keys leave form controls, links and content editors to their own keyboard handling', t => {
  const { key, sample } = inputFixture(t);
  const editor = { tagName: 'DIV', isContentEditable: true };
  const targets = [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
    { tagName: 'A' }, { tagName: 'SUMMARY' }, editor,
    { tagName: 'SPAN', parentElement: editor },
  ];
  for (const target of targets) {
    for (const code of ['Space', 'KeyE', 'KeyQ', 'KeyW', 'ArrowDown']) {
      assert.equal(key('keydown', code, { target }).defaultPrevented, false, `${target.tagName}: ${code}`);
      const controls = sample();
      assert.deepEqual(controls.actions, []);
      assert.equal(Math.hypot(controls.moveX, controls.moveY), 0);
      key('keyup', code, { target });
    }
  }
});

test('releasing a movement key over an editor cannot leave movement held after focus changes', t => {
  const { key, sample } = inputFixture(t);
  key('keydown', 'KeyW');
  assert.ok(Math.hypot(sample().moveX, sample().moveY) > .9);
  key('keyup', 'KeyW', { target: { tagName: 'INPUT' } });
  const controls = sample();
  assert.equal(Math.hypot(controls.moveX, controls.moveY), 0);
});

test('M and Escape remain uncancelled for the separate global shortcuts', t => {
  const { key, sample, canvas } = inputFixture(t);
  const observed = [];
  window.addEventListener('keydown', event => observed.push(event.code));
  for (const target of [canvas, { tagName: 'BUTTON' }, { tagName: 'TEXTAREA' }]) {
    for (const code of ['KeyM', 'Escape']) {
      assert.equal(key('keydown', code, { target }).defaultPrevented, false);
      assert.deepEqual(sample().actions, []);
      key('keyup', code, { target });
    }
  }
  assert.deepEqual(observed, ['KeyM', 'Escape', 'KeyM', 'Escape', 'KeyM', 'Escape']);
});
