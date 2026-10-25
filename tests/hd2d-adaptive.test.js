import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveHD } from '../src/hd2d/adaptive.js';
import { createHD2D } from '../src/hd2d/index.js';

function fixture(options = {}) {
  const saved = new Map(Object.hasOwn(options, 'saved') ? [['ritual-hd', options.saved]] : []);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  let host;
  const adaptive = createAdaptiveHD({ storage, getHost: () => host, ...options });
  host = createHD2D({ scene: { onDisposeObservable: { addOnce() {}, remove() {} } } }, adaptive.settings, []);
  let now = 0;
  function frame(ms, playing = true, hidden = false) { now += ms; adaptive.frame(now, playing, hidden); }
  function run(duration, ms = 10) { for (let elapsed = 0; elapsed < duration; elapsed += ms) frame(ms); }
  frame(0);
  return { adaptive, host, saved, frame, run };
}

test('waits for 3 seconds warmup and a full 4 second window before one step', () => {
  const h = fixture();
  h.run(3000, 20);
  h.run(3980, 20);
  assert.equal(h.host.settings.tier, 'high');
  h.frame(20);
  assert.equal(h.host.settings.tier, 'low');
  h.run(3980, 20);
  assert.equal(h.host.settings.tier, 'low');
  h.frame(20);
  assert.deepEqual(h.host.settings, { tier: 'off', overrides: {} });
  assert.equal(h.saved.size, 0, 'automatic drops never become a manual preference');
});

test('uses nearest-rank p95 strictly above 17.5 ms, including on a fast display', () => {
  const h = fixture(); h.run(3000);
  // 4000 ms: 380*10 + 10*20. Ten slow samples are below the upper 5%.
  h.run(3800); h.run(200, 20);
  assert.equal(h.host.settings.tier, 'high');
  h.run(4000, 17.5);
  assert.equal(h.host.settings.tier, 'high', 'the threshold itself does not trip');
  h.run(4000, 18);
  assert.equal(h.host.settings.tier, 'low');
});

test('three frames over 33 ms lower quality even when p95 is healthy; two do not', () => {
  const h = fixture(); h.run(3000);
  h.frame(40); h.frame(40); h.run(3920);
  assert.equal(h.host.settings.tier, 'high');
  h.frame(40); h.frame(40); h.frame(40); h.run(3880);
  assert.equal(h.host.settings.tier, 'low');
});

test('120 Hz cadence and stable 60 Hz both keep high; fast recovery never promotes', () => {
  const h = fixture();
  h.run(8000, 1000 / 120); h.run(8000, 1000 / 60);
  assert.equal(h.host.settings.tier, 'high');
  h.run(8000, 20);
  assert.equal(h.host.settings.tier, 'off');
  h.run(20000, 1000 / 120);
  assert.equal(h.host.settings.tier, 'off');
});

for (const state of ['menu', 'pause', 'hidden']) {
  test(`${state} discards partial windows and ignores the resume gap`, () => {
    const h = fixture(); h.run(3000); h.run(3900, 20);
    h.frame(60000, state === 'hidden', state === 'hidden');
    h.frame(60000);
    h.run(3000, 20); h.run(3980, 20);
    assert.equal(h.host.settings.tier, 'high');
    h.frame(20);
    assert.equal(h.host.settings.tier, 'low');
  });
}

test('visibility suspension resets even when the browser renders no hidden frame', () => {
  const h = fixture(); h.run(3000); h.run(3900, 20);
  h.adaptive.suspend(); h.frame(90000); h.run(3000, 20); h.run(3980, 20);
  assert.equal(h.host.settings.tier, 'high');
  h.frame(20); assert.equal(h.host.settings.tier, 'low');
});

test('manual selection wins until Auto is explicitly reset and survives reload', () => {
  const h = fixture();
  h.adaptive.select('high'); h.run(20000, 40);
  assert.equal(h.host.settings.tier, 'high');
  assert.equal(h.adaptive.choice, 'high');
  assert.deepEqual(JSON.parse(h.saved.get('ritual-hd')), { tier: 'high', overrides: {} });
  const reload = fixture({ saved: h.saved.get('ritual-hd') }); reload.run(20000, 40);
  assert.equal(reload.host.settings.tier, 'high');
  h.adaptive.select('auto'); h.run(7100, 20);
  assert.equal(h.host.settings.tier, 'low');
  const reset = fixture({ saved: h.saved.get('ritual-hd') });
  assert.equal(reset.adaptive.choice, 'auto');
  assert.equal(reset.host.settings.tier, 'high', 'session downgrade is not stored');
});

test('legacy raw, JSON string and object tiers remain manual, with effect overrides', () => {
  for (const saved of ['low', '"low"', '{"tier":"low","overrides":{"bloom":"high"}}']) {
    const h = fixture({ saved }); h.run(20000, 40);
    assert.equal(h.adaptive.choice, 'low');
    assert.equal(h.host.settings.tier, 'low');
    if (saved.includes('bloom')) assert.deepEqual(h.host.settings.overrides, { bloom: 'high' });
    assert.equal(h.saved.get('ritual-hd'), saved, 'loading does not rewrite the key');
  }
});

test('new and corrupt preferences default to Auto using the existing device tier', () => {
  for (const saved of [undefined, 'garbage', '{}', '{"tier":"ultra"}', 'null', 'false', 'auto', '"auto"', '{"mode":"auto","tier":"off"}']) {
    const h = fixture({ saved, coarse: true });
    assert.equal(h.adaptive.choice, 'auto');
    assert.equal(h.host.settings.tier, 'low');
    h.run(7100, 20); assert.equal(h.host.settings.tier, 'off');
  }
});

test('storage denial permits automatic and manual choices', () => {
  const h = fixture({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
  h.run(7100, 20); assert.equal(h.host.settings.tier, 'low');
  h.adaptive.select('high'); h.run(20000, 40);
  assert.equal(h.host.settings.tier, 'high');
  h.adaptive.select('auto'); assert.equal(h.adaptive.choice, 'auto');
});

test('explicit URL QA overrides stay fixed and a settings choice clears them', () => {
  const h = fixture({ search: '?hd=bloom:high,dof:off', phone: true });
  h.run(20000, 40);
  assert.deepEqual(h.host.settings, { tier: 'low', overrides: { bloom: 'high', dof: 'off' } });
  assert.equal(h.adaptive.choice, 'low');
  h.adaptive.select('auto');
  assert.deepEqual(h.host.settings, { tier: 'low', overrides: {} });
  h.run(7100, 20); assert.equal(h.host.settings.tier, 'off');
  assert.equal(fixture({ search: '?hd=garbage' }).adaptive.choice, 'auto');
  assert.equal(fixture({ saved: 'high', search: '?hd=off' }).host.settings.tier, 'off');
});
