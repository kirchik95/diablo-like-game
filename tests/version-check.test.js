import test from 'node:test';
import assert from 'node:assert/strict';
import { createVersionCheck } from '../src/version-check.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function page({ mode = 'welcome', unsaved = mode !== 'welcome', currentVersion = 'loaded-v1', href = 'http://phone:5174/?seed=42#monk', hidden = false, fetcher } = {}) {
  const doc = Object.assign(new EventTarget(), { hidden });
  const requests = [], navigations = [], notices = [], intervals = [], timeouts = new Map();
  const state = { mode, hasUnsavedProgress: unsaved };
  let serverVersion = 'loaded-v1', nextTimer = 0;
  const win = Object.assign(new EventTarget(), {
    location: { href },
    setInterval(fn, delay) { intervals.push({ fn, delay }); return 1; },
    clearInterval() { intervals.length = 0; },
    setTimeout(fn) { const id = ++nextTimer; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  const checker = createVersionCheck({ doc, win, currentVersion, versionUrl: 'http://phone:5174/version.json',
    getState: () => state, reload: url => navigations.push(url), showUpdate: notice => notices.push(notice),
    fetchVersion: async (url, options) => {
      requests.push({ url, options });
      return fetcher ? fetcher(url, options) : new Response(JSON.stringify({ buildId: serverVersion }));
    },
  });
  return { checker, doc, win, state, requests, navigations, notices, intervals, timeouts,
    version(id) { serverVersion = id; },
    visibility(value) { doc.hidden = !value; doc.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('boot compares against the embedded version and bypasses the HTTP cache', async () => {
  const p = page({ currentVersion: 'stale-v0' });
  await flush();
  assert.equal(p.navigations.length, 1);
  const url = new URL(p.navigations[0]);
  assert.equal(url.origin, 'http://phone:5174');
  assert.equal(url.searchParams.get('seed'), '42');
  assert.equal(url.hash, '#monk');
  assert.equal(url.searchParams.get('__ritual_update'), 'loaded-v1');
  assert.equal(p.requests[0].options.cache, 'no-store');
});

test('unchanged versions never navigate or show an update', async () => {
  const p = page();
  await flush();
  await p.checker.check();
  assert.deepEqual(p.navigations, []);
  assert.deepEqual(p.notices, []);
});

for (const mode of ['playing', 'paused', 'panel']) {
  test(`unfinished ${mode} run is preserved even when the update action is called`, async () => {
    const p = page({ mode });
    await flush();
    p.version('new-v2');
    await p.checker.check();
    const notice = p.notices.at(-1);
    assert.equal(notice.canReload, false);
    assert.equal(notice.reload(), false);
    assert.equal(p.navigations.length, 0);
    p.state.mode = 'paused';
    p.checker.stateChanged();
    assert.equal(p.navigations.length, 0);
  });
}

for (const mode of ['victory', 'defeat']) {
  test(`${mode} shows an explicit update and rechecks safety on tap`, async () => {
    const p = page({ mode: 'playing' });
    await flush();
    p.version('new-v2');
    await p.checker.check();
    p.state.mode = mode;
    p.state.hasUnsavedProgress = false;
    p.checker.stateChanged();
    assert.equal(p.navigations.length, 0);
    assert.equal(p.notices.at(-1).canReload, true);
    const action = p.notices.at(-1).reload;
    p.state.mode = 'playing';
    p.state.hasUnsavedProgress = true;
    assert.equal(action(), false);
    p.state.mode = mode;
    p.state.hasUnsavedProgress = false;
    assert.equal(action(), true);
    assert.equal(p.navigations.length, 1);
    assert.equal(action(), false);
  });
}

test('foreground and persisted pageshow check, while hidden pages never fetch or reload', async () => {
  const p = page();
  await flush();
  assert.equal(p.intervals[0].delay, 180000);
  p.visibility(false);
  p.version('new-v2');
  p.intervals[0].fn();
  await flush();
  assert.equal(p.requests.length, 1);
  p.visibility(true);
  await flush();
  assert.equal(p.navigations.length, 1);
  const b = page({ mode: 'playing' });
  await flush();
  b.version('new-v2');
  b.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await flush();
  assert.equal(b.notices.at(-1).canReload, false);
});

test('visible polling finds an update; hiding during a request postpones its effects', async () => {
  let resolve;
  const p = page({ fetcher: () => new Promise(done => { resolve = done; }) });
  p.visibility(false);
  resolve(new Response(JSON.stringify({ buildId: 'new-v2' })));
  await flush();
  assert.equal(p.navigations.length, 0);
  p.visibility(true);
  resolve(new Response(JSON.stringify({ buildId: 'new-v2' })));
  await flush();
  assert.equal(p.navigations.length, 1);
  const b = page({ mode: 'playing' });
  await flush();
  b.version('new-v2');
  b.intervals[0].fn();
  await flush();
  assert.ok(b.notices.at(-1));
});

test('overlapping resume events share the in-flight request', async () => {
  let resolve;
  const p = page({ fetcher: () => new Promise(done => { resolve = done; }) });
  const pending = p.checker.check();
  p.visibility(true);
  assert.equal(p.requests.length, 1);
  resolve(new Response(JSON.stringify({ buildId: 'loaded-v1' })));
  await pending;
  assert.equal(p.navigations.length, 0);
});

for (const [name, fetcher] of [
  ['offline', () => { throw new TypeError('offline'); }],
  ['404', () => new Response('{}', { status: 404 })],
  ['HTML fallback', () => new Response('<html>app</html>')],
  ['empty id', () => new Response('{"buildId":""}')],
  ['wrong id type', () => new Response('{"buildId":42}')],
  ['oversized id', () => new Response(JSON.stringify({ buildId: 'x'.repeat(300) }))],
]) {
  test(`${name} is ignored without disturbing boot`, async () => {
    const p = page({ fetcher });
    await flush();
    assert.deepEqual(p.navigations, []);
    assert.deepEqual(p.notices, []);
    assert.equal(p.timeouts.size, 0);
  });
}

test('a timed-out fetch is aborted and the next foreground check can recover', async () => {
  let first = true;
  const p = page({ fetcher: (_url, { signal }) => {
    if (!first) return new Response('{"buildId":"new-v2"}');
    first = false;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  [...p.timeouts.values()][0]();
  await flush();
  p.visibility(true);
  await flush();
  assert.equal(p.navigations.length, 1);
});

test('a cache-busted document still stale after navigation does not reload in a loop', async () => {
  const p = page({ currentVersion: 'stale-v0', href: 'http://phone:5174/?__ritual_update=loaded-v1' });
  await flush();
  assert.equal(p.navigations.length, 0);
  assert.equal(p.notices.at(-1).canReload, true);
  assert.equal(p.notices.at(-1).reload(), true);
  assert.equal(p.navigations.length, 1);
  assert.ok(new URL(p.navigations[0]).searchParams.get('__ritual_retry'));
});

test('a reverted deployment removes a pending update instead of reloading to an obsolete id', async () => {
  const p = page({ mode: 'playing' });
  await flush();
  p.version('new-v2'); await p.checker.check();
  p.version('loaded-v1'); await p.checker.check();
  assert.equal(p.notices.at(-1), null);
  p.state.mode = 'welcome'; p.state.hasUnsavedProgress = false;
  p.checker.stateChanged();
  assert.equal(p.navigations.length, 0);
});

test('missing embedded metadata fails closed rather than treating a fetched version as loaded', async () => {
  const p = page({ currentVersion: '' });
  await flush();
  assert.equal(p.requests.length, 0);
  assert.equal(p.navigations.length, 0);
});

test('stop removes listeners and timers and ignores late responses', async () => {
  let resolve;
  const p = page({ fetcher: () => new Promise(done => { resolve = done; }) });
  p.checker.stop();
  resolve(new Response('{"buildId":"new-v2"}'));
  await flush();
  p.visibility(true);
  assert.equal(p.intervals.length, 0);
  assert.equal(p.navigations.length, 0);
  assert.equal(p.requests.length, 1);
});
