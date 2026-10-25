import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPerfOverlay } from '../src/perf-overlay.js';

class FakeTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((n, listeners) => n + listeners.size, 0); }
}

class FakeElement extends FakeTarget {
  constructor(tag, doc) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), doc, children: [], style: {}, attributes: {}, textContent: '', parentNode: null });
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  focus() { this.doc.activeElement = this; }
  select() { this.doc.selection = this; }
  // find('button', 'copy') matches data-perf="copy" too.
  find(tag, perf) {
    for (const child of this.children) {
      if (child.tagName === tag.toUpperCase() && (perf === undefined || child.attributes['data-perf'] === perf)) return child;
      const nested = child.find(tag, perf);
      if (nested) return nested;
    }
    return null;
  }
}

function page({ search = '', stored = null, storageThrows = false, clipboard = 'ok', observer = 'supported' } = {}) {
  let now = 0, created = 0, timerId = 0;
  const timers = new Map(), logs = [], copies = [], observers = [], commands = [];
  const doc = new FakeTarget();
  doc.hidden = false;
  doc.body = new FakeElement('body', doc);
  doc.activeElement = doc.body;
  doc.createElement = tag => { created++; return new FakeElement(tag, doc); };
  doc.execCommand = command => {
    commands.push(command);
    if (command === 'copy' && doc.selection?.tagName === 'TEXTAREA') {
      copies.push(doc.selection.value);
      return true;
    }
    return false;
  };
  const win = Object.assign(new FakeTarget(), {
    document: doc, location: { search }, performance: { now: () => now }, devicePixelRatio: 3,
    navigator: {}, console: { info: (...args) => logs.push(args) },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  Object.defineProperty(win, 'localStorage', { get() {
    if (storageThrows) throw new Error('Storage blocked');
    return { getItem: key => key === 'ritual-perf' ? stored : null };
  } });
  if (clipboard !== 'missing') win.navigator.clipboard = { async writeText(value) {
    if (clipboard === 'reject') throw new Error('Not allowed on HTTP');
    copies.push(value);
  } };
  if (observer !== 'missing') win.PerformanceObserver = class {
    static supportedEntryTypes = observer === 'unsupported' ? ['paint'] : ['longtask'];
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(options) {
      if (observer === 'throws') throw new Error('Unsupported entry type');
      this.options = options;
    }
    disconnect() { this.disconnected = true; }
    emit(entries) { this.callback({ getEntries: () => entries }); }
  };
  return {
    win, doc, timers, logs, copies, observers, commands, get created() { return created; },
    advance(ms) { now += ms; },
    refresh() { for (const timer of timers.values()) timer.callback(); },
    visibility(hidden) { doc.hidden = hidden; doc.dispatchEvent(new Event('visibilitychange')); },
    async copy() {
      const button = doc.body.find('button', 'copy');
      assert.ok(button, 'the enabled panel exposes a copy button');
      button.dispatchEvent(new Event('click', { cancelable: true, bubbles: true }));
      await new Promise(resolve => setImmediate(resolve));
      return JSON.parse(logs.at(-1)[1]);
    },
  };
}

function frame(h, overlay, interval, { steps, sim, render, work = 0 } = {}) {
  h.advance(interval);
  overlay.frameStart();
  if (steps !== undefined || sim !== undefined) overlay.simDone(steps, sim);
  if (render !== undefined) overlay.renderDone(render);
  h.advance(work);
  overlay.frameEnd();
}

test('disabled overlay never touches DOM, timers, observers, engine or frame clock', () => {
  const h = page();
  h.win.performance.now = () => assert.fail('disabled clock read');
  const engine = new Proxy({}, { get() { assert.fail('disabled engine read'); } });
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine });
  assert.equal(overlay.enabled, false);
  overlay.frameStart(); overlay.simDone(2, 4); overlay.renderDone(8); overlay.frameEnd(); overlay.dispose();
  assert.equal(h.created, 0);
  assert.equal(h.doc.listenerCount + h.win.listenerCount + h.timers.size + h.observers.length, 0);
  assert.equal(createPerfOverlay().enabled, false, 'safe to import and create without browser globals');
});

test('only exact query/localStorage opt-ins enable the panel, even with blocked storage', () => {
  for (const [options, enabled] of [
    [{ search: '?perf=1' }, true], [{ search: '?other=2&perf=1', storageThrows: true }, true],
    [{ stored: '1' }, true], [{ search: '?perf=0', stored: '1' }, true],
    [{ search: '?perf=true' }, false], [{ search: '?notperf=1' }, false],
    [{ stored: 'true' }, false], [{ storageThrows: true }, false],
  ]) {
    const h = page(options), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
    assert.equal(overlay.enabled, enabled, JSON.stringify(options));
    assert.equal(h.doc.body.children.length, Number(enabled));
    overlay.dispose();
  }
});

test('panel is safe-area aware and passes pointer input through except its copy button', () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  const panel = h.doc.body.children[0], button = panel.find('button', 'copy');
  assert.equal(panel.style.position, 'fixed');
  assert.equal(panel.style.left, 'var(--perf-left, 50%)');
  assert.equal(panel.style.transform, 'var(--perf-shift, translateX(-50%))');
  assert.match(panel.style.top, /^var\(--perf-top, calc\(env\(safe-area-inset-top, 0px\) \+ /);
  assert.match(panel.style.maxWidth, /safe-area-inset-left/);
  assert.match(panel.style.fontFamily, /system-ui/);
  assert.match(panel.style.background, /var\(--coal/);
  assert.equal(panel.style.pointerEvents, 'none');
  assert.equal(button.style.pointerEvents, 'auto');
  assert.equal(button.textContent, 'Копировать');
  assert.ok(h.timers.size > 0);
  assert.ok([...h.timers.values()].every(timer => timer.delay >= 1000), 'no per-frame DOM refresh');
  overlay.dispose();
});

test('the panel starts as one «FPS» line below the top HUD row; a tap shows the metrics and «Копировать»', () => {
  const h = page({ search: '?perf=1' });
  const engine = { getRenderWidth: () => 633, getRenderHeight: () => 293, getHardwareScalingLevel: () => 4 / 3 };
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine });
  const panel = h.doc.body.children[0], toggle = panel.find('button', 'toggle'), copy = panel.find('button', 'copy');
  const metrics = panel.find('pre');
  assert.deepEqual(panel.children, [toggle, metrics, copy]);
  assert.match(panel.style.top, /var\(--u, 2px\) \* 58/, 'below the orbs, the experience bar, the quest line and the notice');
  // The phone moves it to the left edge under the health orb and the «дыши» line (44u + 9u), only with html.touch-ui.
  const touch = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8').match(/\nhtml\.touch-ui \{ (--perf-top[^}]*)\}/)?.[1];
  assert.equal(touch, '--perf-top: calc(var(--safe-top) + var(--u) * 56); --perf-left: calc(var(--safe-left) + var(--u) * 4); --perf-shift: none; ');
  assert.equal(toggle.style.pointerEvents, 'auto');
  assert.deepEqual([toggle.textContent, toggle.attributes['aria-expanded'], metrics.hidden, copy.hidden], ['FPS 0 ▸', 'false', true, true]);
  for (let i = 0; i <= 121; i++) frame(h, overlay, 1000 / 121);
  h.refresh();
  assert.equal(toggle.textContent, 'FPS 121 ▸', 'a whole number');
  const tap = new Event('click', { cancelable: true, bubbles: true });
  toggle.dispatchEvent(tap);
  assert.equal(tap.defaultPrevented, true);
  assert.deepEqual([toggle.textContent, toggle.attributes['aria-expanded'], metrics.hidden, copy.hidden], ['FPS 121 ▾', 'true', false, false]);
  assert.match(metrics.textContent, /canvas 633×293 ×1\.33\n/, 'the scale is rounded on the panel');
  toggle.dispatchEvent(new Event('click', { cancelable: true }));
  assert.deepEqual([metrics.hidden, copy.hidden], [true, true]);
  overlay.dispose();
  assert.equal(toggle.listenerCount, 0);
});

test('the JSON keeps the full hardware scale', async () => {
  const h = page({ search: '?perf=1' });
  const engine = { getRenderWidth: () => 633, getRenderHeight: () => 293, getHardwareScalingLevel: () => 4 / 3 };
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine });
  assert.equal((await h.copy()).canvas.hardwareScaling, 4 / 3);
  overlay.dispose();
});

test('releasing over the copy button still reaches the game global pointer-release handler', () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  const release = new Event('pointerup', { bubbles: true });
  h.doc.body.find('button', 'copy').dispatchEvent(release);
  assert.equal(release.cancelBubble, false, 'Input clears a held canvas attack on window pointerup');
  overlay.dispose();
});

test('FPS uses frame cadence over one second; percentiles use the last five seconds', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0);
  for (let i = 0; i < 18; i++) frame(h, overlay, 10);
  frame(h, overlay, 20);
  frame(h, overlay, 100);
  let snapshot = await h.copy();
  assert.equal(snapshot.frameMs.samples, 20, 'first frame establishes the cadence baseline');
  assert.deepEqual([snapshot.frameMs.p50, snapshot.frameMs.p95, snapshot.frameMs.max], [10, 20, 100]);
  assert.ok(Math.abs(snapshot.fps - 200 / 3) < .01, '20 frames in 300 ms');
  h.advance(1001);
  snapshot = await h.copy();
  assert.equal(snapshot.fps, 0, 'one-second FPS window expires independently');
  assert.equal(snapshot.frameMs.samples, 20);
  h.advance(4000);
  snapshot = await h.copy();
  assert.deepEqual(snapshot.frameMs, { samples: 0, p50: null, p95: null, max: null });
  overlay.dispose();
});

test('ring wrap keeps recent samples and removes expired slow frames', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0);
  for (let i = 0; i < 100; i++) frame(h, overlay, 100);
  for (let i = 0; i < 12000; i++) frame(h, overlay, 2);
  const snapshot = await h.copy();
  assert.deepEqual(snapshot.frameMs, { samples: 2500, p50: 2, p95: 2, max: 2 });
  assert.equal(snapshot.fps, 500);
  overlay.dispose();
});

test('JSON reports optional simulation/render means, heap bytes, DPR and Babylon dimensions', async () => {
  const h = page({ search: '?perf=1' });
  h.win.performance.memory = { usedJSHeapSize: 1048576, totalJSHeapSize: 2097152, jsHeapSizeLimit: 4194304 };
  const engine = { getRenderWidth: () => 720, getRenderHeight: () => 450, getHardwareScalingLevel: () => 2 };
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine });
  frame(h, overlay, 0);
  frame(h, overlay, 100, { steps: 2, sim: 4, render: 8 });
  frame(h, overlay, 100, { steps: 4, sim: 8, render: 12 });
  frame(h, overlay, 100);
  const snapshot = await h.copy();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.elapsedMs, 300);
  assert.deepEqual(snapshot.windowMs, { fps: 1000, frame: 5000 });
  assert.deepEqual(snapshot.simulation, { samples: 2, stepsPerFrame: 3, ms: 6 });
  assert.equal(snapshot.renderMs, 10);
  assert.deepEqual(snapshot.jsHeap, { usedBytes: 1048576, totalBytes: 2097152, limitBytes: 4194304 });
  assert.equal(snapshot.devicePixelRatio, 3);
  assert.deepEqual(snapshot.canvas, { width: 720, height: 450, hardwareScaling: 2 });
  assert.deepEqual(snapshot.babylon, { drawCalls: null, activeMeshes: null, totalVertices: null });
  assert.deepEqual(JSON.parse(h.copies.at(-1)), snapshot);
  h.refresh();
  assert.match(h.doc.body.find('pre').textContent, /p50.*p95.*max/);
  assert.match(h.doc.body.find('pre').textContent, /720.*450/);
  overlay.dispose();
});

test('unreported and invalid metrics remain null instead of looking like measured zero', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0);
  frame(h, overlay, 20, { steps: NaN, sim: -1, render: Infinity });
  const snapshot = await h.copy();
  assert.deepEqual(snapshot.simulation, { samples: 0, stepsPerFrame: null, ms: null });
  assert.equal(snapshot.renderMs, null);
  assert.equal(snapshot.jsHeap, null);
  assert.deepEqual(snapshot.canvas, { width: null, height: null, hardwareScaling: null });
  overlay.dispose();
});

test('zero simulation steps and milliseconds are measurements, and multiple simDone calls add', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0);
  frame(h, overlay, 20, { steps: 0, sim: 0, render: 0 });
  h.advance(20); overlay.frameStart(); overlay.simDone(1, 2); overlay.simDone(2, 4); overlay.frameEnd();
  const snapshot = await h.copy();
  assert.deepEqual(snapshot.simulation, { samples: 2, stepsPerFrame: 1.5, ms: 3 });
  assert.equal(snapshot.renderMs, 0);
  overlay.dispose();
});

test('frame time includes idle time between frames and does not substitute CPU render time', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0, { work: 3 });
  frame(h, overlay, 97, { render: 2, work: 2 });
  const snapshot = await h.copy();
  assert.equal(snapshot.frameMs.p50, 100);
  assert.equal(snapshot.renderMs, 2);
  overlay.dispose();
});

test('copy logs JSON and falls back on HTTP when Clipboard API is absent or rejects', async () => {
  for (const clipboard of ['missing', 'reject']) {
    const h = page({ search: '?perf=1', clipboard }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
    const button = h.doc.body.find('button', 'copy');
    button.focus();
    const snapshot = await h.copy();
    assert.equal(h.logs[0][0], '[ritual-perf]');
    assert.deepEqual(h.commands, ['copy']);
    assert.deepEqual(JSON.parse(h.copies[0]), snapshot);
    assert.equal(h.doc.body.find('textarea'), null, 'temporary copy field is removed');
    assert.equal(h.doc.activeElement, button, 'copy restores focus');
    overlay.dispose();
  }
});

test('failed clipboard fallback still logs a usable JSON snapshot', async () => {
  const h = page({ search: '?perf=1', clipboard: 'missing' });
  h.doc.execCommand = () => { throw new Error('copy disabled'); };
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  const snapshot = await h.copy();
  assert.equal(snapshot.version, 1);
  assert.equal(h.copies.length, 0);
  assert.equal(h.doc.body.find('textarea'), null);
  assert.equal(h.doc.body.find('button', 'copy').textContent, 'В консоли');
  overlay.dispose();
});

test('long-task observer accumulates entries and duration only when supported', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  assert.equal(h.observers[0].options.type, 'longtask');
  h.observers[0].emit([{ duration: 65 }, { duration: 125 }]);
  assert.deepEqual((await h.copy()).longTasks, { supported: true, count: 2, totalDurationMs: 190 });
  overlay.dispose();
  assert.equal(h.observers[0].disconnected, true);
  for (const observer of ['missing', 'unsupported', 'throws']) {
    const unsupported = page({ search: '?perf=1', observer });
    const other = createPerfOverlay({ win: unsupported.win, doc: unsupported.doc });
    assert.deepEqual((await unsupported.copy()).longTasks, { supported: false, count: 0, totalDurationMs: 0 });
    other.dispose();
  }
});

test('hidden tabs reset cadence so resuming does not record time spent in the background', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  frame(h, overlay, 0); frame(h, overlay, 20);
  h.visibility(true);
  frame(h, overlay, 60000);
  h.visibility(false);
  frame(h, overlay, 0); frame(h, overlay, 25);
  const snapshot = await h.copy();
  assert.deepEqual(snapshot.frameMs, { samples: 1, p50: 25, p95: 25, max: 25 });
  assert.equal(snapshot.fps, 40);
  overlay.dispose();
});

test('dispose removes DOM, timer and listeners and all retained frame hooks become no-ops', async () => {
  const h = page({ search: '?perf=1' }), overlay = createPerfOverlay({ win: h.win, doc: h.doc });
  const panel = h.doc.body.children[0], button = panel.find('button', 'copy'), timer = [...h.timers.values()][0].callback;
  assert.ok(button.listenerCount > 0 && h.doc.listenerCount > 0);
  overlay.dispose(); overlay.dispose();
  assert.equal(h.doc.body.children.length, 0);
  assert.equal(button.listenerCount + panel.listenerCount + h.doc.listenerCount + h.win.listenerCount, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.observers[0].disconnected, true);
  h.win.performance.now = () => assert.fail('disposed clock read');
  overlay.frameStart(); overlay.simDone(2, 4); overlay.renderDone(8); overlay.frameEnd(); timer();
  button.dispatchEvent(new Event('click'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.logs.length, 0);
});

test('enabled Babylon instrumentation is lazy, reports scene counters and releases its observers', async t => {
  const { NullEngine, Scene, MeshBuilder, FreeCamera, Vector3 } = await import('@babylonjs/core');
  const engine = new NullEngine({ renderWidth: 320, renderHeight: 180 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  scene.activeCamera = new FreeCamera('perf-camera', new Vector3(0, 0, -5), scene);
  MeshBuilder.CreateBox('perf-box', {}, scene);
  const h = page({ search: '?perf=1' });
  const baseline = scene.onBeforeAnimationsObservable.observers.length;
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine, scene });
  assert.equal(scene.onBeforeAnimationsObservable.observers.length, baseline, 'no synchronous instrumentation imports');
  for (let i = 0; i < 100 && scene.onBeforeAnimationsObservable.observers.length === baseline; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(scene.onBeforeAnimationsObservable.observers.length, baseline + 1);
  frame(h, overlay, 0);
  h.advance(20); overlay.frameStart(); scene.render(); overlay.frameEnd();
  // NullEngine has no real draw submission; seed its real PerfCounter instead.
  engine._drawCalls.addCount(7, false);
  const snapshot = await h.copy();
  assert.deepEqual(snapshot.babylon, { drawCalls: 7, activeMeshes: 1, totalVertices: 24 });
  assert.equal(Number.isFinite(snapshot.renderMs), true, 'scene instrumentation supplies render time without renderDone');
  assert.deepEqual(snapshot.canvas, { width: 320, height: 180, hardwareScaling: 1 });
  overlay.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scene.onBeforeAnimationsObservable.observers.filter(observer => !observer._willBeUnregistered).length, baseline);
});

test('disposing before a lazy instrumentation import settles never installs observers', async t => {
  const { NullEngine, Scene } = await import('@babylonjs/core');
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const h = page({ search: '?perf=1' }), baseline = scene.onBeforeAnimationsObservable.observers.length;
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, engine, scene });
  overlay.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scene.onBeforeAnimationsObservable.observers.length, baseline);
});


test('FPS panel and copied metrics show the current HD tier after a downgrade', async () => {
  const h = page({ search: '?perf=1' });
  let tier = 'high';
  const overlay = createPerfOverlay({ win: h.win, doc: h.doc, getHD: () => tier });
  assert.match(h.doc.body.find('button', 'toggle').textContent, /HD high/);
  tier = 'low'; h.refresh();
  assert.match(h.doc.body.find('button', 'toggle').textContent, /HD low/);
  assert.equal((await h.copy()).hdTier, 'low');
  tier = 'off'; h.refresh();
  assert.match(h.doc.body.find('button', 'toggle').textContent, /HD off/);
  overlay.dispose();
});
