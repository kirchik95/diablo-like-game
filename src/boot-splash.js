// The boot splash of index.html is the preloader: it covers the page until every game file is loaded and
// the world is drawn, so the start button only shows when the game can start. The bar and the percent run
// through four stages, each up to its share of BOOT_SHARES:
//   code   index.html counts the scripts that arrive until this module runs;
//   files  preload() fetches every world atlas, hit mask, the monk's weapons and loot, the chosen look,
//          all look previews and this screen's panel icons, and counts the bytes as they stream in;
//   world  main.js starts the renderer only then; loadPixelAssets consumes the in-memory preload
//          handoff; its ready promise ends this stage;
//   done   the first frame drawn once the chosen look has settled hides the splash.
// A failure, a lost file among them, shows a short message with «Обновить» instead of an empty page.
// Another look picked later on the start screen loads with the panel's own «Загружаем облик…».
import { lootAssetUrls, monkWeaponUrls, monkWeaponsManifestUrl, pixelAssetUrls } from './pixel-assets.js';
import { hitMaskUrls } from './pixel-scene.js';
import { retainPreloadedAsset, clearPreloadedAssets } from './preloaded-assets.js';
import { appearanceOptions, appearanceVariant } from './appearance.js';
import { iconFile } from './monk-panel.js';
import iconPackage from '../assets/ui/pixel-v5/icons/manifest.json' with { type: 'json' };

// The percent at the end of each stage; index.html keeps the code share below BOOT_SHARES.code.
export const BOOT_SHARES = { code: 30, files: 90, world: 97, done: 100 };
// The bar's track in units: the fill grows in whole units.
export const BOOT_TRACK = 90;

// Every file the start screen and the first fight need; hitMaskUrls are the hit masks loadPixelAssets
// fetches. unit × devicePixelRatio picks the panel icons (monk-panel.js draws them at art scale 1 and 2).
export function gameFiles({ appearance, unit = 2, pixelRatio = 1 } = {}) {
  const looks = appearanceOptions.skins.flatMap(skin => appearanceOptions.hair.flatMap(hair =>
    appearanceOptions.sashes.map(sash => appearanceVariant({ skin: skin.id, hair: hair.id, sash: sash.id }))));
  const icons = Object.keys(iconPackage.icons).flatMap(name => [1, 2].map(scale => iconFile(name, unit * scale * pixelRatio)));
  return [...new Set([
    ...Object.values(pixelAssetUrls), ...hitMaskUrls, ...Object.values(lootAssetUrls),
    monkWeaponsManifestUrl, ...Object.values(monkWeaponUrls),
    appearanceVariant(appearance).url, ...looks.map(look => look.previewUrl), ...icons,
  ].filter(Boolean))];
}

// Fetches every url at once and reports the bytes as they stream in. A file without Content-Length counts
// as the average known size until it ends. A failed file counts as done and goes into failed. Never rejects.
// A data: URL (a small icon or preview the build put into the code) is already in memory: it is not fetched,
// so it cannot skew the average.
export async function preloadFiles(urls, { fetchFile = globalThis.fetch?.bind(globalThis), onProgress = () => {}, onFile = null } = {}) {
  const files = [...new Set(urls)].filter(url => !url.startsWith('data:'))
    .map(url => ({ url, size: 0, loaded: 0, done: false, failed: false }));
  const report = () => onProgress(preloadSummary(files));
  report();
  await Promise.all(files.map(async file => {
    try {
      const response = await fetchFile(file.url);
      const chunks = onFile ? [] : null;
      if (!response.ok) throw new Error(`${response.status} ${file.url}`);
      file.size = Number(response.headers?.get?.('content-length')) || 0;
      const reader = response.body?.getReader?.();
      if (reader) {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          file.loaded += chunk.value.byteLength;
          chunks?.push(chunk.value);
          report();
        }
      } else {
        const bytes = await response.arrayBuffer();
        file.loaded = bytes.byteLength; chunks?.push(bytes);
      }
      if (onFile) await onFile(file.url, new Blob(chunks));
    } catch {
      file.failed = true;
    }
    file.done = true;
    report();
  }));
  return preloadSummary(files);
}

// A file's size is its Content-Length, or what it streamed once it ended. A compressed response streams more
// bytes than its Content-Length: a file counts at most its size, so bytes is about what came over the network.
// Only the last file makes the fraction 1.
export function preloadSummary(files) {
  const size = file => file.size || (file.done ? file.loaded : 0);
  const known = files.filter(file => size(file) > 0);
  const average = known.length ? known.reduce((sum, file) => sum + size(file), 0) / known.length : 0;
  const weight = file => size(file) || (file.done ? 0 : average);
  const total = files.reduce((sum, file) => sum + weight(file), 0);
  const loaded = files.reduce((sum, file) => sum + (file.done ? weight(file) : Math.min(file.loaded, weight(file))), 0);
  const done = files.filter(file => file.done).length;
  return {
    count: files.length, done, bytes: files.reduce((sum, file) => sum + (file.size ? Math.min(file.loaded, file.size) : file.loaded), 0),
    fraction: done === files.length ? 1 : total > 0 ? Math.min(.99, loaded / total) : 0,
    failed: files.filter(file => file.failed).map(file => file.url),
  };
}

// The stage ends show as marks in the browser's performance timeline, for load measurements.
const mark = name => { try { globalThis.performance?.mark?.(name); } catch { /* No user timing. */ } };
const megabytes = bytes => (bytes / 1048576).toFixed(1).replace('.', ',');

export class BootSplash {
  constructor({ doc = globalThis.document, win = globalThis.window, fetchFile = globalThis.fetch?.bind(globalThis) } = {}) {
    Object.assign(this, { doc, win, fetchFile });
    this.root = doc.documentElement;
    this.splash = doc.getElementById('boot-splash');
    this.preloaded = false; this.assets = false; this.done = false;
    // index.html showed the code stage; this module runs, so the code is here.
    const handoff = win.bootProgress;
    if (handoff) { handoff.takenOver = true; handoff.observer?.disconnect(); }
    this.percent = 0;
    mark('boot:code');
    this.show(BOOT_SHARES.code, 'Загружаем мир…');
  }

  // A failure stays until the reload: the bar stops and «Обновить» waits.
  get failed() { return this.root.classList.contains('boot-failed'); }

  // The bar never goes back; the fill grows in whole units.
  show(percent, stage) {
    if (this.done || this.failed) return;
    this.percent = Math.max(this.percent, Math.min(100, Math.floor(percent)));
    const bar = this.doc.getElementById('boot-bar');
    bar?.style.setProperty('--boot-fill', String(Math.floor(this.percent / 100 * BOOT_TRACK)));
    bar?.setAttribute('aria-valuenow', String(this.percent));
    const percentText = this.doc.getElementById('boot-percent');
    if (percentText) percentText.textContent = `${this.percent}%`;
    const stageText = this.doc.getElementById('boot-stage');
    if (stage && stageText && stageText.textContent !== stage) stageText.textContent = stage;
  }

  // Preloads gameFiles() for this look and screen; resolves when every file has arrived or failed. A lost
  // file stops the boot like a lost script: the message and «Обновить» stay, and main.js starts no world.
  async preload(appearance) {
    const unit = parseFloat(this.win.getComputedStyle?.(this.root)?.getPropertyValue('--u')) || 2;
    const urls = gameFiles({ appearance, unit, pixelRatio: this.win.devicePixelRatio || 1 });
    const span = BOOT_SHARES.files - BOOT_SHARES.code;
    const rendererFiles = new Set([...Object.values(pixelAssetUrls), ...hitMaskUrls, ...Object.values(lootAssetUrls),
      monkWeaponsManifestUrl, ...Object.values(monkWeaponUrls), appearanceVariant(appearance).url]);
    const summary = await preloadFiles(urls, { fetchFile: this.fetchFile,
      // Retention is best-effort: the renderer keeps its ordinary transport, Retry UI and optional-art fallbacks.
      onFile: (url, blob) => rendererFiles.has(url) ? retainPreloadedAsset(url, blob).catch(() => {}) : undefined,
      onProgress: ({ fraction, bytes }) =>
      this.show(BOOT_SHARES.code + fraction * span, `Загружаем мир · ${megabytes(bytes)} МБ`) });
    this.preloaded = true;
    this.summary = summary;
    mark('boot:preloaded');
    if (summary.failed.length) {
      console.error('Не загрузились файлы игры:', summary.failed);
      this.fail('Не удалось загрузить игру', 'Часть файлов игры не загрузилась. Проверь соединение и обнови страницу.');
      return summary;
    }
    this.show(BOOT_SHARES.files, 'Собираем мир…');
    await this.painted();
    return summary;
  }

  // main.js builds the world right after the preload and holds the main thread for seconds on a phone:
  // the new stage paints first. A hidden tab paints no frame, so a timer also ends the wait.
  painted() {
    const { requestAnimationFrame: frame, setTimeout: later } = this.win;
    if (!frame || !later) return Promise.resolve();
    return new Promise(resolve => {
      frame.call(this.win, () => later.call(this.win, resolve, 0));
      later.call(this.win, resolve, 100);
    });
  }

  // renderer.ready resolved: the atlases are on the GPU and the hit masks decoded.
  worldReady() {
    this.assets = true;
    mark('boot:world');
    this.show(BOOT_SHARES.world, 'Почти готово…');
  }

  // main.js calls this after every drawn frame. The first one after the world, with the chosen look
  // loaded or failed (the start screen shows its retry), ends the splash.
  frame(lookSettled) {
    if (!this.assets || !lookSettled || this.done || this.failed) return;
    this.show(BOOT_SHARES.done, 'Готово');
    this.ready();
  }

  // The page shows under the splash, which fades out (at once with reduced motion) and leaves the DOM.
  ready() {
    if (this.done || this.failed) return;
    this.done = true;
    mark('boot:ready');
    this.root.classList.remove('booting');
    const splash = this.splash;
    if (!splash) return;
    splash.setAttribute('aria-busy', 'false');
    if (this.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { splash.remove(); return; }
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    // A tab in the background runs no transition: the timer removes the splash anyway.
    this.win.setTimeout(remove, 400);
    splash.classList.add('boot-leaving');
  }

  // A failure before the world is drawn: a short message and «Обновить» instead of an empty page.
  fail(title, copy) {
    if (this.done) return;
    clearPreloadedAssets();
    const text = (id, value) => { const node = this.doc.getElementById(id); if (node && value) node.textContent = value; };
    text('boot-error-title', title);
    text('boot-error-copy', copy);
    this.root.classList.add('boot-failed');
    this.splash?.setAttribute('aria-busy', 'false');
    this.doc.getElementById('boot-reload')?.focus({ preventScroll: true });
  }
}
