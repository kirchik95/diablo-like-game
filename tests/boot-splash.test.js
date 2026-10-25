import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOT_SHARES, BOOT_TRACK, BootSplash, gameFiles, preloadFiles, preloadSummary } from '../src/boot-splash.js';
import { lootAssetUrls, monkWeaponUrls, monkWeaponsManifestUrl, pixelAssetUrls } from '../src/pixel-assets.js';
import { hitMaskUrls } from '../src/pixel-scene.js';
import { appearanceOptions, appearanceVariant, normalizeAppearance } from '../src/appearance.js';
import { iconFile } from '../src/monk-panel.js';
import iconPackage from '../assets/ui/pixel-v5/icons/manifest.json' with { type: 'json' };

const text = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = text('../index.html');
const styles = text('../src/styles.css');
const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const splashMarkup = html.match(/<div id="boot-splash"[\s\S]*?\n {4}<\/div>\n/)[0];
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

class Classes {
  constructor(names = []) { this.names = new Set(names); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}

// A splash node: attributes keep their history, so a test can read every value the bar showed.
function node(textContent = '') {
  return {
    textContent, attrs: {}, history: [],
    setAttribute(name, value) { this.attrs[name] = value; this.history.push([name, value]); },
    style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
  };
}

// The splash nodes main.js reaches through BootSplash, with the start texts of the index.html markup.
function page({ unit = ' 2px', reduce = false, pixelRatio = 1, handoff, paint = false } = {}) {
  const root = { classList: new Classes(['booting']) };
  const splash = Object.assign(new EventTarget(), node(), { classList: new Classes(), removed: false });
  splash.remove = () => { splash.removed = true; };
  const reload = { focused: false, focus() { this.focused = true; } };
  const ids = {
    'boot-splash': splash, 'boot-bar': node(), 'boot-reload': reload,
    'boot-percent': node(splashMarkup.match(/<b id="boot-percent">([^<]*)<\/b>/)[1]),
    'boot-stage': node(splashMarkup.match(/<span id="boot-stage">([^<]*)<\/span>/)[1]),
    'boot-error-title': node('Не удалось загрузить игру'), 'boot-error-copy': node('Проверь соединение и обнови страницу.'),
  };
  const doc = { documentElement: root, getElementById: id => ids[id] ?? null };
  const timers = [];
  const frames = [];
  const win = {
    devicePixelRatio: pixelRatio, bootProgress: handoff,
    requestAnimationFrame: paint ? callback => frames.push(callback) : undefined,
    getComputedStyle: () => ({ getPropertyValue: name => (name === '--u' ? unit : '') }),
    matchMedia: query => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }),
    setTimeout: callback => timers.push(callback),
  };
  const bar = ids['boot-bar'];
  return {
    root, splash, reload, ids, doc, win, timers, frames, bar,
    fill: () => Number(bar.style.props['--boot-fill']),
    percent: () => ids['boot-percent'].textContent, stage: () => ids['boot-stage'].textContent,
    shown: () => bar.history.filter(([name]) => name === 'aria-valuenow').map(([, value]) => Number(value)),
  };
}

// A fetch Response stand-in that streams its body in the given chunks; size is its Content-Length.
function response(chunks, { size = chunks.reduce((sum, chunk) => sum + chunk, 0), ok = true, status = 200 } = {}) {
  const queue = [...chunks];
  return {
    ok, status, headers: { get: name => (name === 'content-length' && size ? String(size) : null) },
    body: { getReader: () => ({ read: async () => (queue.length ? { done: false, value: new Uint8Array(queue.shift()) } : { done: true }) }) },
  };
}

test('index.html draws the splash before any CSS or JS: inline style, first in body, no external file', () => {
  assert.match(html, /<html lang="ru" class="booting">/);
  assert.ok(html.indexOf('<style>') < html.indexOf('</head>'), 'the style is in the head');
  assert.match(html, /<body>\s*<!--[^>]*-->\s*<div id="boot-splash"/, 'the splash is the first element of the body');
  assert.ok(html.indexOf('id="boot-splash"') < html.indexOf('<script type="module" src="/src/main.js">'));
  // Until boot-splash.js removes html.booting, only the splash shows: the start screen and its button wait.
  assert.match(inlineStyle, /html\.booting body > :not\(#boot-splash\) \{ visibility: hidden; \}/);
  assert.match(inlineStyle, /html\.booting, html\.booting body \{ height: 100%; margin: 0; overflow: hidden; background: #171321; \}/);
  // The colours are the palette of styles.css; the splash keeps clear of the notch and the home bar.
  const token = name => styles.match(new RegExp(`${name}: (#[0-9a-f]{6});`))[1];
  assert.match(inlineStyle, new RegExp(`background: ${token('--ink')}; color: ${token('--muted')};`));
  assert.match(inlineStyle, /\.boot-title \{[^}]*color: #eee0ce;/);
  assert.equal(token('--ivory'), '#eee0ce');
  for (const side of ['top', 'right', 'bottom', 'left']) assert.match(inlineStyle, new RegExp(`max\\(8px, env\\(safe-area-inset-${side}\\)\\)`));
  // One unit follows --u of styles.css: 2 px, 3 px from 1920×1080, 4 px from 2560×1440.
  assert.match(inlineStyle, /--bu: 2px;/);
  assert.match(styles, /:root \{[^}]*--u: 2px;/);
  assert.match(inlineStyle, /@media \(min-width: 1920px\) and \(min-height: 1080px\) \{ #boot-splash \{ --bu: 3px; \} \}/);
  assert.match(inlineStyle, /@media \(min-width: 2560px\) and \(min-height: 1440px\) \{ #boot-splash \{ --bu: 4px; \} \}/);
  // The bar is a BOOT_TRACK-unit track; the fill grows in whole units, so its edge stays crisp.
  assert.match(inlineStyle, new RegExp(`\\.boot-bar \\{ width: calc\\(var\\(--bu\\) \\* ${BOOT_TRACK}\\);[^}]*margin: 0 auto;`));
  // A wider label never moves the bar, and new numbers never move the label.
  assert.match(inlineStyle, /\.boot-label \{[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(inlineStyle, /\.boot-fill \{[^}]*width: calc\(var\(--bu\) \* var\(--boot-fill, 0\)\);/);
  // The system font and no external file.
  assert.match(inlineStyle, /-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif/);
  assert.doesNotMatch(inlineStyle + splashMarkup + inlineScript, /url\(|https?:|src=/);
  assert.match(splashMarkup, /<p class="boot-title">Ночной ритуал<\/p>/);
  assert.match(splashMarkup, /role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="boot-fill"><\/div><\/div>/);
  assert.match(splashMarkup, /<p class="boot-label"><b id="boot-percent">0%<\/b> · <span id="boot-stage">Загружаем код игры…<\/span><\/p>/);
  assert.match(splashMarkup, /<button id="boot-reload" type="button">Обновить<\/button>/);
  // Reduced motion: no fade, no blinking unit.
  assert.match(inlineStyle, /@media \(prefers-reduced-motion: reduce\) \{\s*#boot-splash \{ transition: none; \}\s*\.boot-fill::after \{ animation: none; \}/);
  // The code stage of index.html ends where boot-splash.js starts.
  assert.match(inlineScript, new RegExp(`const CODE = ${BOOT_SHARES.code}, TRACK = ${BOOT_TRACK},`));
  assert.deepEqual(Object.values(BOOT_SHARES), [30, 90, 97, 100]);
});

test('gameFiles lists every world atlas, hit mask, loot, weapon, the chosen look, all previews and the panel icons once', () => {
  const appearance = normalizeAppearance({ skin: appearanceOptions.skins.at(-1).id, hair: appearanceOptions.hair.at(-1).id });
  const files = gameFiles({ appearance, unit: 2, pixelRatio: 1 });
  assert.equal(new Set(files).size, files.length, 'no file twice');
  for (const url of [...Object.values(pixelAssetUrls), ...hitMaskUrls, ...Object.values(lootAssetUrls),
    monkWeaponsManifestUrl, ...Object.values(monkWeaponUrls)]) assert.ok(files.includes(url), url);
  // The chosen look's atlas; every look's preview for the picker, but no other look's atlas.
  assert.ok(files.includes(appearanceVariant(appearance).url));
  const looks = appearanceOptions.skins.flatMap(skin => appearanceOptions.hair.flatMap(hair =>
    appearanceOptions.sashes.map(sash => appearanceVariant({ skin: skin.id, hair: hair.id, sash: sash.id }))));
  assert.equal(looks.length, 18);
  for (const look of looks) {
    assert.ok(files.includes(look.previewUrl), look.previewUrl);
    assert.equal(files.includes(look.url), look.url === appearanceVariant(appearance).url);
  }
  // monk-panel.js draws an icon at art scale 1 and 2: unit × scale × devicePixelRatio, capped at 4.
  const names = Object.keys(iconPackage.icons);
  assert.ok(names.length > 0);
  for (const name of names) for (const pixels of [2, 4]) assert.ok(files.includes(iconFile(name, pixels)), `${name} ×${pixels}`);
  const retina = gameFiles({ appearance, unit: 2, pixelRatio: 3 });
  for (const name of names) assert.ok(retina.includes(iconFile(name, 4)));
  assert.ok(!retina.includes(iconFile(names[0], 2)), 'no icon this screen never draws');
  // Every url points into the project.
  for (const url of files) assert.match(url, /\/assets\/.+\.(png|json)$/);
});

test('the preload follows what loadPixelAssets fetches: its hit-mask list and every url export of pixel-assets.js', () => {
  // pixel-scene.js exports the hit masks it fetches (tests/asset-progress.test.js checks the list): no copy here.
  const scene = text('../src/pixel-scene.js'), boot = text('../src/boot-splash.js');
  assert.match(boot, /^import \{ hitMaskUrls \} from '\.\/pixel-scene\.js';$/m);
  assert.doesNotMatch(boot, /hit-masks\.json/);
  assert.ok(hitMaskUrls.length >= 10);
  // A new url list in pixel-assets.js that loadPixelAssets reads must reach the preload too.
  const sceneImports = scene.match(/import \{([^}]*)\} from '\.\/pixel-assets\.js';/)[1].match(/\w+Urls?\b/g);
  const bootImports = boot.match(/import \{([^}]*)\} from '\.\/pixel-assets\.js';/)[1].match(/\w+Urls?\b/g);
  assert.deepEqual([...sceneImports].sort(), [...bootImports].sort());
  assert.equal((scene.match(/\bfetch\(/g) || []).length, 2, 'loadPixelAssets fetches the hit masks and the weapons manifest only');
});

test('preloadFiles fetches every url at once, counts the streamed bytes and never rejects', async () => {
  const calls = [], seen = [];
  const files = {
    'a.png': () => response([400, 600]),
    'b.json': () => response([300], { size: 0 }),
    'c.png': () => response([], { ok: false, status: 404 }),
    'd.png': () => { throw new TypeError('offline'); },
  };
  const summary = await preloadFiles(['a.png', 'b.json', 'a.png', 'c.png', 'd.png', 'data:image/png;base64,iVBORw0KGgo='], {
    fetchFile: async url => { calls.push(url); return files[url](); },
    onProgress: progress => seen.push(progress),
  });
  assert.deepEqual(calls, ['a.png', 'b.json', 'c.png', 'd.png'], 'each file once; an inlined data: URL needs no fetch');
  assert.deepEqual(summary, { count: 4, done: 4, bytes: 1300, fraction: 1, failed: ['c.png', 'd.png'] });
  assert.equal(seen[0].fraction, 0, 'the first report comes before any byte');
  assert.ok(seen.some(progress => progress.fraction > 0 && progress.fraction < 1), 'the bar moves while bytes stream');
  for (const progress of seen) assert.ok(progress.fraction >= 0 && progress.fraction <= 1);
  assert.equal(seen.at(-1).fraction, 1);
  // Without fetch every file counts as failed, and the game decides.
  const lost = await preloadFiles(['a.png'], { fetchFile: undefined });
  assert.deepEqual(lost.failed, ['a.png']);
  assert.equal(lost.fraction, 1);
  assert.deepEqual(await preloadFiles([]), { count: 0, done: 0, bytes: 0, fraction: 1, failed: [] });
});

test('preloadSummary weighs files by size: a file without Content-Length counts as the average, a compressed one up to its size', () => {
  const file = (size, loaded, done = false) => ({ size, loaded, done, failed: false });
  assert.equal(preloadSummary([file(100, 50), file(0, 20)]).fraction, 70 / 200, 'the unknown file weighs the average 100');
  assert.equal(preloadSummary([file(10, 30), file(10, 0)]).fraction, .5, 'a gzip body counts at most its size');
  assert.equal(preloadSummary([file(100, 100, true), file(0, 40, true)]).fraction, 1);
  assert.equal(preloadSummary([file(0, 0), file(0, 0)]).fraction, 0, 'no size yet: no progress');
  assert.equal(preloadSummary([file(0, 10, true), file(0, 0)]).fraction, .5, 'a finished file of unknown size weighs what it streamed');
  assert.equal(preloadSummary([file(0, 0, true), file(0, 0)]).fraction, 0, 'an empty or failed file says nothing about the rest');
  assert.equal(preloadSummary([file(100, 100, true), file(0, 0, true), file(100, 0)]).fraction, .5);
  assert.equal(preloadSummary([file(100, 100, true), file(100, 100)]).fraction, .99, 'only the last file ends the stage');
  assert.equal(preloadSummary([file(100, 50), file(0, 20)]).bytes, 70);
  assert.equal(preloadSummary([file(10, 30), file(10, 80, true), file(0, 5, true)]).bytes, 25, 'gzip: about the network bytes');
});

test('BootSplash takes the bar over from index.html at the code share and preloads the files for this screen', async () => {
  const handoff = { percent: 12, takenOver: false, observer: { stopped: false, disconnect() { this.stopped = true; } } };
  const view = page({ unit: ' 3px', pixelRatio: 1, handoff, paint: true });
  const asked = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchFile = async url => { asked.push(url); await gate; return response([1000, 1000], { size: 2000 }); };
  const boot = new BootSplash({ doc: view.doc, win: view.win, fetchFile });
  assert.equal(handoff.takenOver, true, 'index.html stops drawing');
  assert.equal(handoff.observer.stopped, true);
  assert.equal(view.percent(), `${BOOT_SHARES.code}%`);
  assert.equal(view.fill(), Math.floor(BOOT_SHARES.code / 100 * BOOT_TRACK));
  assert.equal(view.stage(), 'Загружаем мир…');
  const appearance = normalizeAppearance({ sash: appearanceOptions.sashes.at(-1).id });
  const pending = boot.preload(appearance);
  await flush();
  assert.deepEqual(asked, gameFiles({ appearance, unit: 3, pixelRatio: 1 }), 'the files for this look, unit and screen');
  assert.equal(boot.preloaded, false);
  release();
  await flush();
  assert.equal(view.stage(), 'Собираем мир…');
  assert.equal(boot.preloaded, true);
  let settled = false;
  pending.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, 'main.js waits until the stage has painted');
  const [fallback] = view.timers;
  view.frames.shift()();
  await flush();
  assert.equal(settled, false, 'after the frame, a task');
  view.timers.pop()();
  const summary = await pending;
  fallback();
  assert.equal(summary.count, asked.length);
  assert.equal(summary.bytes, asked.length * 2000);
  assert.equal(boot.preloaded, true);
  assert.equal(view.percent(), `${BOOT_SHARES.files}%`);
  assert.equal(view.stage(), 'Собираем мир…');
  const shown = view.shown();
  assert.ok(shown.some(value => value > BOOT_SHARES.code && value < BOOT_SHARES.files), 'the bar moves with the bytes');
  assert.deepEqual(shown, [...shown].sort((a, b) => a - b), 'the bar never goes back');
  assert.equal(view.root.classList.contains('booting'), true, 'the start screen still waits for the world');
});

test('a hidden tab paints no frame: a timer ends the wait for the stage paint', async () => {
  const view = page({ paint: true });
  const boot = new BootSplash({ doc: view.doc, win: view.win });
  let settled = false;
  boot.painted().then(() => { settled = true; });
  await flush();
  assert.equal(settled, false);
  assert.equal(view.frames.length, 1);
  view.timers[0]();
  await flush();
  assert.equal(settled, true);
});

test('the preload shows the megabytes as they arrive', async () => {
  const view = page();
  const stages = [];
  const boot = new BootSplash({ doc: view.doc, win: view.win, fetchFile: async url => (url.endsWith('.json') ? response([786432, 786432]) : response([4096])) });
  const show = boot.show.bind(boot);
  boot.show = (percent, stage) => { stages.push(stage); show(percent, stage); };
  const summary = await boot.preload(normalizeAppearance());
  assert.ok(stages.includes('Загружаем мир · 0,0 МБ'));
  assert.ok(stages.some(stage => /^Загружаем мир · \d+,\d МБ$/.test(stage) && stage !== 'Загружаем мир · 0,0 МБ'));
  assert.deepEqual(summary.failed, []);
  assert.equal(view.percent(), `${BOOT_SHARES.files}%`);
  assert.equal(view.root.classList.contains('boot-failed'), false);
});

test('a lost file stops the boot like a lost script: the message and «Обновить» stay, the bar stops', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const view = page();
  const lost = hitMaskUrls[0];
  const boot = new BootSplash({ doc: view.doc, win: view.win,
    fetchFile: async url => (url === lost ? response([], { ok: false, status: 404 }) : response([2048])) });
  const summary = await boot.preload(normalizeAppearance());
  assert.deepEqual(summary.failed, [lost]);
  assert.equal(boot.failed, true, 'main.js reads boot.failed and starts no world');
  assert.equal(view.root.classList.contains('boot-failed'), true);
  assert.equal(view.root.classList.contains('booting'), true, 'the start screen stays hidden');
  assert.equal(view.ids['boot-error-title'].textContent, 'Не удалось загрузить игру');
  assert.equal(view.ids['boot-error-copy'].textContent, 'Часть файлов игры не загрузилась. Проверь соединение и обнови страницу.');
  assert.equal(view.reload.focused, true, '«Обновить» takes the focus');
  assert.notEqual(view.stage(), 'Собираем мир…', 'the bar stops before the world stage');
  assert.deepEqual(logged.mock.calls[0].arguments, ['Не загрузились файлы игры:', [lost]]);
  // A network error, not only an HTTP error, stops it too.
  const offline = page();
  const dropped = new BootSplash({ doc: offline.doc, win: offline.win,
    fetchFile: async url => { if (url.endsWith('.json')) throw new TypeError('Failed to fetch'); return response([2048]); } });
  await dropped.preload(normalizeAppearance());
  assert.equal(offline.root.classList.contains('boot-failed'), true);
});

test('the world art and then a frame with the chosen look settled end the splash: html.booting goes, the splash fades out', () => {
  const view = page();
  const boot = new BootSplash({ doc: view.doc, win: view.win });
  boot.show(BOOT_SHARES.files, 'Собираем мир…');
  boot.frame(true);
  assert.equal(view.root.classList.contains('booting'), true, 'a frame before the world art changes nothing');
  boot.worldReady();
  assert.equal(view.percent(), `${BOOT_SHARES.world}%`);
  assert.equal(view.stage(), 'Почти готово…');
  boot.frame(false);
  assert.equal(view.root.classList.contains('booting'), true, 'the chosen look is still loading');
  boot.frame(true);
  assert.equal(view.percent(), '100%');
  assert.equal(view.fill(), BOOT_TRACK);
  assert.equal(view.stage(), 'Готово');
  assert.equal(view.root.classList.contains('booting'), false, 'the start screen shows under the splash');
  assert.equal(view.splash.classList.contains('boot-leaving'), true, 'the splash fades');
  assert.equal(view.splash.attrs['aria-busy'], 'false');
  assert.equal(view.splash.removed, false);
  view.splash.dispatchEvent(new Event('transitionend'));
  assert.equal(view.splash.removed, true, 'the faded splash leaves the DOM');
  assert.equal(view.timers.length, 1, 'a timer removes it when no transition runs');
  boot.frame(true); boot.ready(); boot.show(10, 'x');
  assert.equal(view.timers.length, 1, 'later frames do nothing');
  assert.equal(view.stage(), 'Готово');
  // Reduced motion: no fade, the splash goes at once.
  const still = page({ reduce: true });
  const quiet = new BootSplash({ doc: still.doc, win: still.win });
  quiet.worldReady(); quiet.frame(true);
  assert.equal(still.splash.removed, true);
  assert.equal(still.splash.classList.contains('boot-leaving'), false);
  assert.equal(still.root.classList.contains('booting'), false);
});

test('a failure before the world is drawn shows the message with «Обновить» and stays', () => {
  const view = page();
  const boot = new BootSplash({ doc: view.doc, win: view.win });
  boot.fail('Не удалось загрузить мир', 'Один из игровых ресурсов не загрузился. Обнови страницу, чтобы попробовать снова.');
  assert.equal(view.root.classList.contains('boot-failed'), true);
  assert.equal(view.ids['boot-error-title'].textContent, 'Не удалось загрузить мир');
  assert.match(view.ids['boot-error-copy'].textContent, /^Один из игровых ресурсов/);
  assert.equal(view.reload.focused, true, 'the keyboard reaches «Обновить»');
  assert.equal(view.splash.attrs['aria-busy'], 'false');
  boot.worldReady(); boot.frame(true);
  assert.equal(view.percent(), `${BOOT_SHARES.code}%`, 'the bar stops');
  assert.equal(view.root.classList.contains('booting'), true, 'the game stays hidden behind the message');
  assert.equal(view.splash.removed, false);
  // index.html: the failed state hides the bar and shows the message.
  assert.match(inlineStyle, /html\.boot-failed \.boot-progress \{ display: none; \}\s*html\.boot-failed \.boot-error \{ display: block; \}/);
  // A failure after the splash is gone changes nothing.
  const late = page();
  const done = new BootSplash({ doc: late.doc, win: late.win });
  done.worldReady(); done.frame(true); done.fail('x', 'y');
  assert.equal(late.root.classList.contains('boot-failed'), false);
});

// Runs the inline head script of index.html against a fake page.
function runInline({ built = false, observer = true } = {}) {
  const root = { classList: new Classes(['booting']) };
  const listeners = {}, location = { reloads: 0, reload() { this.reloads++; } };
  class ErrorEvent { constructor(message) { this.message = message; } }
  const bar = node(), percent = node('0%');
  const code = built
    ? ['/assets/index.js', '/assets/babylon-1.js', '/assets/babylon-2.js', '/assets/index.css']
    : ['/src/main.js'];
  const document = {
    documentElement: root,
    addEventListener: (type, listener) => { listeners[`document:${type}`] = listener; },
    getElementById: id => ({ 'boot-bar': bar, 'boot-percent': percent })[id] ?? null,
    querySelectorAll: () => code.map(url => (url.endsWith('.css') ? { href: url } : { src: url })),
    querySelector: selector => (built && selector === 'link[rel="modulepreload"]' ? {} : null),
  };
  const addEventListener = (type, listener, capture) => { listeners[type] = { listener, capture }; };
  let watcher = null;
  class PerformanceObserver {
    constructor(callback) {
      if (!observer) throw new TypeError('no resource timing');
      watcher = this; this.callback = callback; this.disconnected = false;
    }
    observe(options) { this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const window = {};
  new Function('document', 'addEventListener', 'location', 'ErrorEvent', 'window', 'PerformanceObserver', inlineScript)(
    document, addEventListener, location, ErrorEvent, window, PerformanceObserver);
  const failed = () => root.classList.contains('boot-failed');
  const arrive = (...names) => watcher.callback({ getEntries: () => names.map(name => ({ name })) });
  return { root, listeners, location, ErrorEvent, failed, error: event => listeners.error.listener(event), window, bar, percent, watcher: () => watcher, arrive };
}

test('before the game module runs, a lost script or stylesheet or a boot error shows the message; «Обновить» reloads', () => {
  // Vite puts the built script, preloads and stylesheet at the end of the head: the listener comes first.
  assert.ok(html.indexOf(inlineScript) < html.indexOf('</head>'), 'the script is in the head');
  assert.ok(html.indexOf(inlineScript) > html.indexOf('</style>'));
  const boot = runInline();
  assert.equal(boot.listeners.error.capture, true, 'resource errors do not bubble: the window listens in the capture phase');
  boot.error({ target: { tagName: 'IMG' } });
  boot.error({ target: { tagName: 'LINK', rel: 'icon' } });
  assert.equal(boot.failed(), false, 'a lost image or icon is not fatal');
  boot.error({ target: { tagName: 'SCRIPT' } });
  assert.equal(boot.failed(), true, 'a lost game script');
  for (const rel of ['stylesheet', 'modulepreload']) {
    const style = runInline();
    style.error({ target: { tagName: 'LINK', rel } });
    assert.equal(style.failed(), true, `a lost ${rel}`);
  }
  const thrown = runInline();
  thrown.error(new thrown.ErrorEvent('boom'));
  assert.equal(thrown.failed(), true, 'an error thrown while booting');
  const late = runInline();
  late.root.classList.remove('booting');
  late.error(new late.ErrorEvent('later'));
  late.error({ target: { tagName: 'SCRIPT' } });
  assert.equal(late.failed(), false, 'after the splash the game handles its own errors');
  boot.listeners['document:click']({ target: { id: 'game' } });
  assert.equal(boot.location.reloads, 0);
  boot.listeners['document:click']({ target: { id: 'boot-reload' } });
  assert.equal(boot.location.reloads, 1, '«Обновить» reloads');
});

test('index.html counts the code as it arrives: a build by its listed chunks, the dev server by an approach; both stop below 30%', () => {
  const built = runInline({ built: true });
  assert.deepEqual(built.watcher().options, { type: 'resource', buffered: true }, 'scripts that came before the script ran count too');
  assert.equal(built.window.bootProgress.observer, built.watcher());
  built.arrive('/assets/index.js', '/assets/babylon-1.js', '/assets/logo.png');
  assert.equal(built.window.bootProgress.percent, 15, 'two of four listed chunks: half the code share');
  assert.equal(built.percent.textContent, '15%');
  assert.equal(built.bar.style.props['--boot-fill'], String(Math.floor(.15 * BOOT_TRACK)));
  assert.equal(built.bar.attrs['aria-valuenow'], '15');
  built.arrive('/assets/babylon-2.js', '/assets/index.css');
  assert.equal(built.window.bootProgress.percent, BOOT_SHARES.code - 1, 'all code in: boot-splash.js shows the code share');
  // The dev server lists one script and finds the modules as they arrive.
  const dev = runInline();
  dev.arrive(...Array.from({ length: 150 }, (_, index) => `/src/module-${index}.js`));
  assert.equal(dev.window.bootProgress.percent, Math.floor((1 - Math.exp(-1)) * BOOT_SHARES.code));
  dev.arrive(...Array.from({ length: 900 }, (_, index) => `/node_modules/dep-${index}.js`));
  assert.equal(dev.window.bootProgress.percent, BOOT_SHARES.code - 1);
  dev.arrive('/src/module-0.js');
  assert.equal(dev.window.bootProgress.percent, BOOT_SHARES.code - 1, 'the bar never goes back');
  // The DOM is parsed after the first counts: DOMContentLoaded draws the last one.
  dev.percent.textContent = '0%';
  dev.listeners['document:DOMContentLoaded']();
  assert.equal(dev.percent.textContent, `${BOOT_SHARES.code - 1}%`);
  // boot-splash.js took over: index.html draws no more.
  dev.window.bootProgress.takenOver = true;
  dev.percent.textContent = '30%';
  dev.listeners['document:DOMContentLoaded']();
  assert.equal(dev.percent.textContent, '30%');
  // No resource timing: the bar waits at 0% for the module, and the error listener still works.
  const bare = runInline({ observer: false });
  assert.equal(bare.window.bootProgress.observer, null);
  assert.equal(bare.window.bootProgress.percent, 0);
  bare.error({ target: { tagName: 'SCRIPT' } });
  assert.equal(bare.failed(), true);
});

test('preload can hand streamed bytes to the renderer and waits for the consumer before finishing', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const handed = [];
  const pending = preloadFiles(['atlas.png'], {
    fetchFile: async () => new Response(new Uint8Array([1, 2, 3])),
    onFile: async (url, blob) => { handed.push([url, [...new Uint8Array(await blob.arrayBuffer())]]); await gate; },
  });
  let finished = false; pending.then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(handed, [['atlas.png', [1, 2, 3]]]);
  assert.equal(finished, false);
  release();
  assert.equal((await pending).fraction, 1);
  const broken = await preloadFiles(['bad.png'], {
    fetchFile: async () => new Response('bad'), onFile: async () => { throw Error('decode failed'); },
  });
  assert.deepEqual(broken.failed, ['bad.png']);
});

test('a failed in-memory optimization leaves renderer retry and optional-art fallbacks available', async t => {
  t.mock.method(URL, 'createObjectURL', () => { throw new Error('object URL unavailable'); });
  t.mock.method(console, 'error', () => {});
  const view = page();
  const boot = new BootSplash({ doc: view.doc, win: view.win, fetchFile: async () => new Response('not a PNG') });
  const summary = await boot.preload(normalizeAppearance());
  assert.deepEqual(summary.failed, [], 'retention is an optimization; the existing loader owns decoding errors');
  assert.equal(boot.failed, false, 'startWorld must reach appearance retry or optional-art fallbacks');
  assert.equal(boot.preloaded, true);
  assert.equal(view.stage(), 'Собираем мир…');
});
