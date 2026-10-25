import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTier, parseHD, createTierSettings, effectTier, saveTierSettings, normalizeSettings } from '../src/hd2d/tiers.js';
import { createHD2D, probe } from '../src/hd2d/index.js';

const store = value => ({ getItem: () => value, setItem(key, value) { this.saved = [key, value]; } });
const context = () => {
  const callbacks = new Set();
  return { scene: { onDisposeObservable: { addOnce(fn) { callbacks.add(fn); return fn; }, remove(fn) { callbacks.delete(fn); } } }, renderer: {}, callbacks };
};

test('device defaults give phones and coarse pointers low, desktop high', () => {
  assert.equal(defaultTier(), 'high');
  assert.equal(defaultTier({ coarse: true }), 'low');
  assert.equal(defaultTier({ phone: true }), 'low');
});

test('global URL tiers replace stored overrides; effect URLs preserve the base tier', () => {
  assert.deepEqual(parseHD('off', { tier: 'high', overrides: { bloom: 'low' } }), { tier: 'off', overrides: {} });
  assert.deepEqual(parseHD('bloom:high,dof:off', { tier: 'low', overrides: {} }), { tier: 'low', overrides: { bloom: 'high', dof: 'off' } });
  assert.equal(effectTier(parseHD('bloom:high,dof:off', { tier: 'low' }), 'terrain'), 'low');
});

test('malformed URL tokens are ignored and duplicate effect tokens use the last valid tier', () => {
  const result = parseHD('bloom:high,bloom:low,dof:bad,lights:off:extra,__proto__:high,broken', { tier: 'high', overrides: {} });
  assert.deepEqual(result, { tier: 'high', overrides: { bloom: 'low' } });
  assert.deepEqual(parseHD('', result), result);
  assert.deepEqual(normalizeSettings({ tier: 'no', overrides: { dof: 'off', bloom: 'bad' } }, 'low'), { tier: 'low', overrides: { dof: 'off' } });
});

test('saved tier is loaded before URL override without writing URL values to storage', () => {
  const storage = store(JSON.stringify({ tier: 'high', overrides: { bloom: 'off' } }));
  const value = createTierSettings({ storage, search: '?hd=dof:off', coarse: true });
  assert.deepEqual(value, { tier: 'high', overrides: { bloom: 'off', dof: 'off' } });
  assert.equal(storage.saved, undefined);
  assert.deepEqual(createTierSettings({ storage, search: '?hd=low' }), { tier: 'low', overrides: {} });
});

test('invalid or denied storage falls back to device defaults and saving never throws', () => {
  for (const value of ['{broken', 'null', '42', '"bad"', '{"tier":"bad"}', null]) {
    assert.equal(createTierSettings({ storage: store(value), search: '', coarse: true }).tier, 'low');
  }
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(createTierSettings({ storage: denied, search: '', coarse: true }).tier, 'low');
  assert.equal(saveTierSettings(denied, 'off'), false);
  assert.equal(saveTierSettings(null, 'off'), false);
  const storage = store(null);
  assert.equal(saveTierSettings(storage, { tier: 'high', overrides: { bloom: 'off' } }), true);
  assert.deepEqual(storage.saved, ['ritual-hd', '{"tier":"high","overrides":{"bloom":"off"}}']);
  assert.equal(createTierSettings({ storage: store('low'), search: '' }).tier, 'low');
});

test('host installs in order with complete context, updates once and disposes in reverse order once', () => {
  const ctx = context(), events = [];
  const module = (id, order) => ({ id, order, install(input) {
    assert.equal(input.scene, ctx.scene); assert.equal(input.renderer, ctx.renderer);
    events.push(`install:${id}:${input.tier}`);
    return { setTier(t) { events.push(`tier:${id}:${t}`); }, update(dt, time) { events.push(`update:${id}:${dt}:${time}`); },
      onWorld(renderer) { assert.equal(renderer, ctx.renderer); events.push(`world:${id}`); }, dispose() { events.push(`dispose:${id}`); } };
  } });
  const host = createHD2D(ctx, { tier: 'low', overrides: { bloom: 'off' } }, [module('bloom', 80), module('terrain', 10)]);
  assert.deepEqual(events, ['install:terrain:low', 'install:bloom:off']);
  host.update(.016, 2); host.onWorld(ctx.renderer);
  assert.deepEqual(events.slice(2), ['update:terrain:0.016:2', 'world:terrain', 'world:bloom']);
  host.setTier('high'); host.update(.02, 3);
  assert.deepEqual(events.slice(-4), ['tier:terrain:high', 'tier:bloom:high', 'update:terrain:0.02:3', 'update:bloom:0.02:3']);
  const disposeScene = [...ctx.callbacks][0]; disposeScene(); host.dispose();
  assert.deepEqual(events.slice(-2), ['dispose:bloom', 'dispose:terrain']);
  assert.equal(host.active, false); assert.equal(ctx.callbacks.size, 0);
  const count = events.length; host.update(.02, 4); host.onWorld(ctx.renderer); host.setTier('low');
  assert.equal(events.length, count);
});

test('all-off has no frame callbacks or reads of disabled update methods and tier changes deduplicate', () => {
  const ctx = context(); let updatesRead = 0, tierCalls = 0;
  const module = { id: 'probe', order: 1, install() { return {
    get update() { updatesRead++; return () => assert.fail('disabled effect updated'); },
    setTier() { tierCalls++; }, dispose() {},
  }; } };
  const host = createHD2D(ctx, 'off', [module]);
  for (let i = 0; i < 10000; i++) host.update(.016, i);
  host.setTier('off');
  assert.equal(host.active, false); assert.equal(updatesRead, 0); assert.equal(tierCalls, 0);
  host.dispose();
});

test('empty explicit registry has no active frame work at any tier; built-in probe is opt-in', () => {
  const ctx = context(), host = createHD2D(ctx, 'high', []);
  assert.equal(host.active, false); host.update(.1, 1); host.dispose();
  const instance = probe.install({ tier: 'low' });
  instance.update(.01, 1); assert.equal(instance.frames, 1);
  instance.setTier('off'); assert.equal(instance.tier, 'off'); instance.dispose();
  assert.equal(instance.disposed, true);
});

test('every effect is released when a disposer throws and partial installation rolls back', () => {
  const ctx = context(), cleaned = [];
  const module = id => ({ id, order: id === 'a' ? 1 : 2, install() { return {
    setTier() {}, update() {}, dispose() { cleaned.push(id); if (id === 'b') throw Error('cleanup failed'); },
  }; } });
  const host = createHD2D(ctx, 'off', [module('a'), module('b')]);
  assert.throws(() => host.dispose(), /cleanup failed/);
  assert.deepEqual(cleaned, ['b', 'a']);
  assert.equal(ctx.callbacks.size, 0);
  cleaned.length = 0;
  assert.throws(() => createHD2D(ctx, 'off', [module('a'), { id: 'broken', order: 3, install() { throw Error('install failed'); } }]), /install failed/);
  assert.deepEqual(cleaned, ['a']);
});

test('effect names never pick up inherited object properties', () => {
  assert.equal(effectTier({ tier: 'low', overrides: {} }, 'constructor'), 'low');
});
