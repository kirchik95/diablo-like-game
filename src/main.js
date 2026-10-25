import { crowdFixture, crowdControls, stressCount } from '../scripts/crowd-fixture.js';
import './styles.css';
import './hd2d/settings.css';
import './version-notice.css';
import './onboarding.css';
import './onboarding.js';
import { createVersionCheck } from './version-check.js';
import { createVersionNotice } from './version-notice.js';
import { createAdventure, updateGame, startDash, useSlot, interact, getInteractionPrompt, getObjective, CACHE_TEXT, cacheProgress, warmGameNavigation } from './game.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Renderer } from './render.js';
// HD-2D adaptive: presentation-only quality governor.
import { createAdaptiveHD } from './hd2d/adaptive.js';
import { MotionHistory } from './render-interpolation.js';
import { appearanceOptions, appearanceVariant, normalizeAppearance } from './appearance.js';
import { MONK_RULES } from './monk-combat.js';
import { damageMultiplier, unspentPoints, xpProgress } from './progression.js';
import { SKILLS, SLOTS, createLoadout } from './skills.js';
import { skillParams, slotStates } from './run-progress.js';
import { RARITIES, comboStats, weaponCombo } from './items.js';
import { MonkPanel, pauseLegend } from './monk-panel.js';
import { physicalCode } from './key-codes.js';
import { GamepadInput, controlKeys, slotKey } from './gamepad.js';
import { TouchInput } from './touch.js';
import { TouchUI } from './touch-ui.js';
import { BootSplash } from './boot-splash.js';
import { createPerfOverlay } from './perf-overlay.js';
import { createRunAutosave, readSave, restoreRun } from './save-game.js';

// The splash of index.html stays until the first frame after the world art (boot-splash.js).
const boot = new BootSplash();
const $ = id => document.getElementById(id);
const canvas = $('game');
const crowdCount = stressCount(window.location.search);
let selectedAppearance = normalizeAppearance();
let game = createRun();
let mode = 'welcome';
let renderer, input, onboarding;
let worldReady = false;
let accumulator = 0, hitStop = 0, noticeTimer, endTimer;
// Fixed simulation step. Frames draw bodies blended between the last two steps, at
// accumulator / STEP. Pause and menus keep the accumulator, so the frame holds still.
const STEP = 1 / 120;
const motion = new MotionHistory();
const audio = new GameAudio();
// The sound switch in «Настройки» keeps its choice across reloads; setMuted works before the first unlock.
const SOUND_KEY = 'ritual-sound';
try { if (localStorage.getItem(SOUND_KEY) === 'off') audio.setMuted(true); } catch { /* Private mode can deny storage. */ }
// The graphics switch turns the picture layers (prop shade, light pools, zone grade) on or off together.
// The renderer starts with the saved choice; it does not exist yet here.
const GRAPHICS_KEY = 'ritual-graphics';
let graphicsOn = true;
try { if (localStorage.getItem(GRAPHICS_KEY) === 'off') graphicsOn = false; } catch { /* Private mode can deny storage. */ }
const graphicsSettings = () => ({ propShade: graphicsOn, lightPools: graphicsOn, zoneGrade: graphicsOn });
// The «FPS» switch shows the performance panel (perf-overlay.js); ?perf=1 still turns it on for one visit.
// HD-2D adaptive: Auto is visit-local; legacy saved tiers and URL QA stay manual.
const hdStorage = () => { try { return localStorage; } catch { return null; } };
const hdAdaptive = createAdaptiveHD({ storage: hdStorage(), search: window.location.search,
  coarse: matchMedia('(pointer: coarse)').matches, phone: /Android|iPhone|iPod/.test(navigator.userAgent),
  getHost: () => renderer?.hd2d });
// HD-2D adaptive: end.
const PERF_KEY = 'ritual-perf';
let perfOn = new URLSearchParams(window.location.search).get('perf') === '1';
try { if (localStorage.getItem(PERF_KEY) === '1') perfOn = true; } catch { /* Private mode can deny storage. */ }
let perf = createPerfOverlay({ enabled: false });
const MINIMAP_KEY = 'ritual-minimap';
let minimapOn = true;
try { if (localStorage.getItem(MINIMAP_KEY) === '0') minimapOn = false; } catch { /* Private mode can deny storage. */ }
// Sound must never stop input or the render loop: a failing call is reported once and skipped.
let audioFailed = false;
function guardAudio(call) {
  try { call(); } catch (error) {
    if (!audioFailed) console.error(error);
    audioFailed = true;
  }
}
// Footsteps read the ground's grass/soil/stone mask; without it they fall back to the area.
const groundMask = () => renderer?.scene.materials.find(material => material.metadata?.surfaceMap)?.metadata.surfaceMap;
const overlay = $('overlay');
const playButton = $('play');
const restartButton = $('restart');
const continueButton = $('continue-run');
let savedRun = null;
try { if (!crowdCount) savedRun = readSave(localStorage); } catch { /* Storage getter may be denied. */ }
const autosave = createRunAutosave({ getGame: () => game, getMode: () => crowdCount ? 'welcome' : mode,
  getStorage: () => { try { return localStorage; } catch { return null; } }, onZoneSaved: () => notice('Забег сохранён') });
function showSavedRun() {
  const available = !!savedRun && (mode === 'welcome' || mode === 'defeat');
  continueButton.hidden = !available;
  continueButton.querySelector('span').textContent = mode === 'defeat' ? 'Продолжить с костра' : 'Продолжить забег';
  const zone = savedRun && game.world.zones.find(zone => zone.id === savedRun.checkpoint.zoneId);
  $('continue-detail').textContent = savedRun ? `Ур. ${savedRun.progression.level} · ${zone?.title ?? ''}` : '';
  playButton.classList.toggle('save-new-run', available);
}
showSavedRun();
const killCount = $('kill-count');
const lootLines = $('loot-lines');
const appearancePicker = $('appearance-picker');
const appearanceLoading = $('appearance-loading');
const appearanceStatus = $('appearance-status');
const appearanceRetry = $('appearance-retry');
const interactionPrompt = $('interaction-prompt');
const minimap = $('minimap');
// The map strip in route order. The cemetery and the orchard are side zones: shown after their first entry.
const zoneIds = ['camp', 'road', 'cemetery', 'courtyard', 'orchard'];
const sideZoneIds = ['cemetery', 'orchard'];
let monsterIds = '';
document.body.classList.add('menu-open');
// «Монах» (§5.5): C, I, K or Tab open it from play; the simulation waits in mode 'panel'.
const panel = new MonkPanel($('monk-panel'), { getGame: () => game, onClose: closePanel, doc: document });
// PS and Xbox pads (gamepad.js): the frame loop polls them; the keycaps follow the last used device.
const gamepad = new GamepadInput({
  getGamepads: () => navigator.getGamepads?.() ?? [],
  onEvent: (type, detail) => { if (type === 'device') showControls(detail.device === 'pad' ? detail.family : null); },
});
// Phone touch (touch.js, touch-ui.js): the layer starts on a coarse pointer or the first touch.
// Android «назад» closes «Монах» or pauses; touch-ui.js keeps the page.
const touch = new TouchInput({ getGame: () => game, isActive: () => mode === 'playing' && game.phase === 'playing' && !onboarding?.paused });
const touchUI = new TouchUI({ touch, getGame: () => game, onPause: pauseRun, onActivate: () => showControls(),
  onBack: () => (mode === 'panel' ? closePanel() : pauseRun()) });
// The labels of the device in use: a pad while it is in use, the touch labels on a phone, else the keyboard.
const currentKeys = () => (gamepad.device === 'pad' ? gamepad.keys() : controlKeys(touchUI.active ? 'touch' : null));
onboarding = $('onboarding')?.controller;
$('onboarding')?.addEventListener('onboarding-release', () => { clearInput(); canvas.focus({ preventScroll: true }); });
function updateOnboarding(dt = 0) {
  onboarding?.update(game, { mode, keys: currentKeys(), inputMode: gamepad.device === 'pad' ? 'pad' : touchUI.active ? 'touch' : 'keyboard', dt, hidden: document.hidden });
}

const versionCheck = createVersionCheck({
  doc: document, win: window,
  versionUrl: new URL(`${import.meta.env.BASE_URL}version.json`, window.location.href).href,
  getState: () => ({ mode, hasUnsavedProgress: !['welcome', 'victory', 'defeat'].includes(mode) }),
  showUpdate: createVersionNotice(document),
});

for (const [key, options] of [['skin', appearanceOptions.skins], ['hair', appearanceOptions.hair], ['sash', appearanceOptions.sashes]]) {
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'appearance-choice';
    label.title = option.label;
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = key; radio.value = option.id;
    radio.checked = selectedAppearance[key] === option.id;
    const chip = document.createElement('span');
    chip.className = `appearance-chip ${key === 'hair' ? 'hair-chip' : 'color-chip'}`;
    if (key !== 'hair') {
      const color = document.createElement('i');
      color.className = `choice-color ${key}-${option.id}`;
      color.setAttribute('aria-hidden', 'true');
      chip.append(color);
    }
    const text = document.createElement('span');
    text.className = key === 'hair' ? '' : 'sr-only';
    text.textContent = option.label;
    chip.append(text); label.append(radio, chip);
    $(`${key}-options`).append(label);
  }
}

function updateAppearance() {
  const variant = appearanceVariant(selectedAppearance);
  const skin = appearanceOptions.skins.find(option => option.id === selectedAppearance.skin).label;
  const hair = appearanceOptions.hair.find(option => option.id === selectedAppearance.hair).label;
  const sash = appearanceOptions.sashes.find(option => option.id === selectedAppearance.sash).label;
  const description = `Кожа: ${skin.toLowerCase()}. ${hair}. Пояс: ${sash.toLowerCase()}.`;
  // Assign the newest source directly: no older load callback may restore an earlier choice.
  $('appearance-preview').src = variant.previewUrl;
  $('appearance-preview').alt = description;
  $('appearance-description').textContent = description;
  $('skin-value').textContent = skin;
  $('sash-value').textContent = sash;
  game.appearance = normalizeAppearance(selectedAppearance);
  updateAppearanceStatus();
}

function updateAppearanceStatus() {
  // Query the current choice even before its first render: an older, loaded
  // atlas must never confirm a new selection or a late retry response.
  const status = renderer ? renderer.getAppearanceStatus(game).status : 'loading';
  const ready = worldReady && status === 'ready';
  playButton.disabled = restartButton.disabled = continueButton.disabled = !ready;
  appearanceLoading.hidden = status === 'ready';
  const message = status === 'error' ? 'Не удалось загрузить облик.' : status === 'loading' ? 'Загружаем облик…' : '';
  if (appearanceStatus.textContent !== message) appearanceStatus.textContent = message;
  appearanceRetry.hidden = appearanceRetry.disabled = status !== 'error';
  if (mode === 'welcome') playButton.firstElementChild.textContent = worldReady ? 'Начать путь' : 'Пробуждаем мир…';
  return ready;
}

appearancePicker.addEventListener('change', event => {
  const { target } = event;
  if (mode !== 'welcome' || !target.matches('input[type="radio"]:checked')) return;
  selectedAppearance = normalizeAppearance({ ...selectedAppearance, [target.name]: target.value });
  updateAppearance();
});
appearanceRetry.addEventListener('click', () => {
  if (mode !== 'welcome' || !renderer || renderer.getAppearanceStatus(game).status !== 'error') return;
  const pending = renderer.retryAppearance(game);
  updateAppearanceStatus();
  // Both outcomes re-read the latest selection instead of applying old status.
  pending.then(updateAppearanceStatus, updateAppearanceStatus);
});
updateAppearance();

// Notices queue up and show one at a time for 3.2 s (§5.3). A title adds an amber first line.
// A notice already showing or waiting is not queued again.
const noticeQueue = [];
let noticeShown = null;
function notice(message, title = '') {
  if ([noticeShown, ...noticeQueue].some(entry => entry?.message === message && entry.title === title)) return;
  noticeQueue.push({ message, title });
  if (!noticeShown) nextNotice();
}

function nextNotice() {
  const element = $('notice');
  noticeShown = noticeQueue.shift() ?? null;
  if (!noticeShown) { element.classList.remove('show'); return; }
  if (noticeShown.title) {
    const title = document.createElement('strong'), body = document.createElement('span');
    title.className = 'notice-title';
    title.textContent = noticeShown.title; body.textContent = noticeShown.message;
    element.replaceChildren(title, body);
  } else element.textContent = noticeShown.message;
  element.classList.add('show');
  clearTimeout(noticeTimer);
  // The old notice fades out (.18 s) before the next one comes in.
  noticeTimer = setTimeout(() => {
    element.classList.remove('show');
    noticeTimer = setTimeout(nextNotice, 200);
  }, 3200);
}

function clearNotices() {
  noticeQueue.length = 0; noticeShown = null;
  clearTimeout(noticeTimer);
  $('notice').classList.remove('show');
}

// Drops queued presses of the keyboard, the mouse, the pad and the fingers; a held RT waits for a release.
function clearInput() { input?.clear(); gamepad.clear(); touchUI.release(); }

function showPanel(nextMode) {
  mode = nextMode;
  clearInput(); hitStop = 0;
  overlay.classList.remove('closed');
  overlay.inert = false;
  document.body.classList.add('menu-open');
  appearancePicker.hidden = nextMode !== 'welcome';
  restartButton.hidden = nextMode !== 'paused';
  $('pause-controls').hidden = nextMode !== 'paused';
  $('pause-settings').hidden = nextMode !== 'paused';
  $('entry-hint').hidden = nextMode === 'paused';
  const ended = nextMode === 'defeat' || nextMode === 'victory';
  $('run-summary').hidden = !ended;
  $('run-trophy').hidden = nextMode !== 'victory' || !game.adventure.rewardCollected;
  if (ended) {
    const seconds = Math.floor(game.adventure.elapsed);
    $('summary-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('summary-kills').textContent = game.adventure.totalKills;
    const caches = cacheProgress(game);
    $('summary-secret').textContent = `${caches.found} из ${caches.total}`;
    $('summary-places').textContent = game.adventure.visited.length;
  }
  if (nextMode === 'paused') {
    fillLegend();
    $('panel-eyebrow').textContent = 'КОРОТКАЯ ПЕРЕДЫШКА';
    $('panel-title').innerHTML = 'Сохрани<br/> дыхание';
    $('panel-copy').textContent = 'Мир подождёт. Продолжай, когда будешь готов.';
    playButton.firstElementChild.textContent = 'Продолжить';
  } else if (nextMode === 'defeat') {
    $('panel-eyebrow').textContent = 'ПУТЬ ЕЩЁ НЕ ОКОНЧЕН';
    $('panel-title').innerHTML = 'Пепел<br/> помнит тебя';
    $('panel-copy').textContent = `Здесь путь оборвался: ${currentArea().title.toLowerCase()}. Собирай дух ударами и разрывай окружение волной или рывком.`;
    playButton.firstElementChild.textContent = 'Попробовать снова';
    $('entry-hint').textContent = 'Новый путь с тем же обликом. Все встречи начнутся заново.';
  } else if (nextMode === 'victory') {
    $('panel-eyebrow').textContent = 'ВОЗВРАЩЕНИЕ К ОГНЮ';
    $('panel-title').innerHTML = 'Тишина<br/> возвращается';
    $('panel-copy').textContent = 'Источник ритуала разрушен. Ты вернулся к огню и получил янтарную бусину.';
    playButton.firstElementChild.textContent = 'Пройти ещё раз';
    $('entry-hint').textContent = 'Трофей этого пути. Облик сохранится при повторе.';
  }
  try { savedRun = crowdCount ? null : readSave(localStorage); } catch { savedRun = null; }
  showSavedRun();
  updateHud();
  updateAppearanceStatus();
  (continueButton.hidden ? playButton : continueButton).focus({ preventScroll: true });
}

function createRun() {
  if (crowdCount) {
    canvas.setAttribute('data-run-seed', '7');
    return crowdFixture(crowdCount);
  }
  const replay = new URLSearchParams(window.location.search).get('seed');
  const seed = replay !== null && /^\d+$/.test(replay) && Number(replay) <= 0xffffffff
    ? Number(replay) : crypto.getRandomValues(new Uint32Array(1))[0];
  const run = createAdventure(normalizeAppearance(selectedAppearance), { seed });
  canvas.setAttribute('data-run-seed', String(run.seed));
  return run;
}

function begin(fresh = false, saved = null) {
  if (touchUI.blocked || !updateAppearanceStatus()) return;
  if (fresh || mode === 'welcome' || game.phase !== 'playing') {
    if (saved) {
      const restored = createAdventure(normalizeAppearance(selectedAppearance), { seed: saved.seed });
      if (!restoreRun(restored, saved)) return;
      game = restored;
      canvas.setAttribute('data-run-seed', String(game.seed));
    } else {
      game = createRun();
      if (!crowdCount) onboarding?.startRun(game);
    }
    accumulator = 0;
    clearTimeout(endTimer);
    clearNotices();
    panel.reset();
    const keys = currentKeys();
    if (!saved) notice(keys.touch ? 'Следуй по дороге к монастырю · держи «Удар» — серия · кнопка 1 — волна'
      : `Следуй по дороге к монастырю · ${keys.attack} — удары, ${keys['slot:rmb']} — волна`);
  }
  mode = 'playing'; hitStop = 0;
  autosave.start();
  clearInput(); guardAudio(() => audio.unlock());
  overlay.classList.add('closed'); overlay.inert = true;
  document.body.classList.remove('menu-open');
  updateHud();
  canvas.focus({ preventScroll: true });
  updateOnboarding();
}

function togglePause() {
  if (mode === 'paused') begin();
  else pauseRun();
}

// «Пауза» on the phone, a turn to portrait and Android «назад»: «Монах» closes and a running game pauses.
function pauseRun() {
  if (mode === 'panel') closePanel();
  if (mode === 'playing' && game.phase === 'playing') showPanel('paused');
}

// The panel pauses like the pause menu: the accumulator holds, input drops, the HUD dims.
function openPanel(tab) {
  if (mode !== 'playing' || game.phase !== 'playing') return;
  mode = 'panel'; hitStop = 0;
  clearInput();
  document.body.classList.add('menu-open');
  panel.open(tab === 'next' ? undefined : tab);
  onboarding?.panelOpened();
  updateHud();
}

$('level-points-button').addEventListener('click', () => openPanel('character'));

function closePanel() {
  if (mode !== 'panel') return;
  panel.close();
  mode = 'playing';
  clearInput();
  document.body.classList.remove('menu-open');
  updateHud();
  canvas.focus({ preventScroll: true });
}
function showSound() {
  const button = $('sound'), on = !audio.muted;
  button.setAttribute('aria-checked', String(on));
  button.textContent = on ? 'Вкл' : 'Выкл';
  button.title = `${on ? 'Выключить' : 'Включить'} звук (M)`;
}
function toggleSound() {
  audio.setMuted(!audio.muted);
  try { localStorage.setItem(SOUND_KEY, audio.muted ? 'off' : 'on'); } catch { /* Private mode can deny storage. */ }
  showSound();
}
function showGraphics() {
  const button = $('graphics');
  button.setAttribute('aria-checked', String(graphicsOn));
  button.textContent = graphicsOn ? 'Вкл' : 'Выкл';
  button.title = `${graphicsOn ? 'Выключить' : 'Включить'} эффекты графики`;
}
// HD-2D adaptive: a settings click overrides Auto until an explicit reset.
const hdButtons = ['auto', 'off', 'low', 'high'].map(tier => ({ tier, button: $(`hd2d-${tier}`) }));
function showHD2D() {
  for (const { tier, button } of hdButtons) button.setAttribute('aria-pressed', String(tier === hdAdaptive.choice));
  $('hd2d-options').title = Object.keys(hdAdaptive.settings.overrides).length ? 'Заданы отдельные эффекты через URL' : 'Качество HD-2D';
}
for (const { tier, button } of hdButtons) button.addEventListener('click', () => {
  hdAdaptive.select(tier);
  showHD2D();
});
showHD2D();
// HD-2D adaptive: end.

function showPerf() {
  const button = $('perf');
  button.setAttribute('aria-checked', String(perfOn));
  button.textContent = perfOn ? 'Вкл' : 'Выкл';
  button.title = `${perfOn ? 'Скрыть' : 'Показать'} счётчик FPS`;
}
// The panel needs the renderer; before the world starts the switch only stores the choice.
// A panel that fails to build must not stop the game: it then stays off.
function mountPerf() {
  perf.dispose();
  perf = createPerfOverlay({ enabled: false });
  if (!renderer || !perfOn) return;
  try {
    perf = createPerfOverlay({ win: window, doc: document, engine: renderer.engine, scene: renderer.scene, enabled: true,
      // HD-2D adaptive: read on overlay refresh, including its compact FPS line.
      getHD: () => hdAdaptive.tier });
  } catch (error) {
    console.error(error);
  }
}
function togglePerf() {
  perfOn = !perfOn;
  try { localStorage.setItem(PERF_KEY, perfOn ? '1' : '0'); } catch { /* Private mode can deny storage. */ }
  showPerf();
  mountPerf();
}
function showMinimap() {
  const button = $('minimap-toggle');
  button.setAttribute('aria-checked', String(minimapOn));
  button.textContent = minimapOn ? 'Вкл' : 'Выкл';
  button.title = `${minimapOn ? 'Скрыть' : 'Показать'} миникарту`;
  document.body.classList.toggle('minimap-off', !minimapOn);
  fitMinimap();
}
function toggleMinimap() {
  minimapOn = !minimapOn;
  try { localStorage.setItem(MINIMAP_KEY, minimapOn ? '1' : '0'); } catch { /* Private mode can deny storage. */ }
  showMinimap();
}
function toggleGraphics() {
  graphicsOn = !graphicsOn;
  renderer?.setGraphics(graphicsSettings());
  try { localStorage.setItem(GRAPHICS_KEY, graphicsOn ? 'on' : 'off'); } catch { /* Private mode can deny storage. */ }
  showGraphics();
}

playButton.addEventListener('click', () => begin());
continueButton.addEventListener('click', () => {
  try { savedRun = readSave(localStorage); } catch { savedRun = null; }
  if (savedRun) begin(true, savedRun); else showSavedRun();
});
// After a call, Siri or the Control Center iPhone Safari leaves the sound "interrupted" and resumes it only
// inside a later pointerup or touchend. Only an existing context resumes: the first unlock in begin() starts the music.
const resumeAudio = () => guardAudio(() => {
  if (audio.context && audio.context.state !== 'running') audio.context.resume().catch(() => {});
});
window.addEventListener('pointerup', resumeAudio);
window.addEventListener('touchend', resumeAudio, { passive: true });
restartButton.addEventListener('click', () => begin(true));
$('pause').addEventListener('click', togglePause);
$('sound').addEventListener('click', toggleSound);
showSound();
$('graphics').addEventListener('click', toggleGraphics);
showGraphics();
$('perf').addEventListener('click', togglePerf);
showPerf();
$('minimap-toggle').addEventListener('click', toggleMinimap);
showMinimap();
// Physical keys in any layout (key-codes.js): a Russian layout still pauses with Esc and mutes with M.
window.addEventListener('keydown', e => {
  if (mode === 'panel') { panelKey(e); return; }
  const code = physicalCode(e);
  if (mode !== 'playing' && code === 'Tab') {
    const focusable = overlayStops();
    const first = focusable[0], last = focusable.at(-1);
    if (first && (!focusable.includes(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last))) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (code === 'Escape') { e.preventDefault(); togglePause(); }
  if (code === 'KeyM') toggleSound();
});
// Panel keys: C, I, K, Tab and Esc switch or close; Q and F slot the technique under the pointer; arrows move
// the focus. A handled key stops here, so the play input never sees the key that closed the panel.
function panelKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const code = physicalCode(e);
  if (code.startsWith('Arrow')) {
    e.preventDefault();
    panel.moveFocus(code === 'ArrowUp' || code === 'ArrowLeft' ? -1 : 1);
    return;
  }
  const result = e.repeat ? null : panel.key(e);
  if (result || code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); }
  if (result === 'close') closePanel();
  else if (!result && !e.repeat && code === 'KeyM') toggleSound();
}
window.addEventListener('blur', () => {
  dropHolds();
  if (mode === 'playing' && game.phase === 'playing') showPanel('paused');
});

// Keys and the mouse take the keycaps back from the pad. A pointermove without travel
// (the browser sends one when the page changes under a resting mouse) does not.
let pointerAt = null;
window.addEventListener('keydown', () => gamepad.setDevice('keyboard'));
window.addEventListener('pointerdown', () => gamepad.setDevice('keyboard'));
window.addEventListener('pointermove', e => {
  const moved = pointerAt && Math.hypot(e.clientX - pointerAt.x, e.clientY - pointerAt.y) > 4;
  pointerAt ??= { x: 0, y: 0 };
  pointerAt.x = e.clientX; pointerAt.y = e.clientY;
  if (moved) gamepad.setDevice('keyboard');
}, { passive: true });

// The menu stops in Tab order: enabled buttons and the chosen look of each appearance row.
function overlayStops() {
  return [...overlay.querySelectorAll('button:not([disabled]), input:checked'),
    ...document.querySelectorAll('.version-update button:not([disabled])')]
    .filter(element => !element.hidden && element.getClientRects().length);
}

// Pad buttons outside the fight. Options pauses and resumes, Create (View) opens and closes «Монах».
// In the panel and the menus the D-pad moves the focus, ✕ (A) presses the focused control,
// ○ (B) steps back and L1 / R1 (LB / RB) switch the panel tabs. Presses after a screen change
// belong to the old screen, so they stop there; the screen change drops the gameplay presses.
// □ (X) held on a bag item drops it like a held RMB; letting go early keeps the item.
const NAV_STEPS = { 'nav:up': -1, 'nav:left': -1, 'nav:down': 1, 'nav:right': 1 };
let padHold = false;
// A release outside the page never arrives: blur and a hidden page end the drop hold in any mode.
function dropHolds() { panel.release(); padHold = false; }
function padButtons(actions) {
  if (padHold && !(mode === 'panel' && gamepad.holding('slot:rmb'))) { panel.release(); padHold = false; }
  const screen = mode;
  for (const action of actions) {
    if (mode !== screen) break;
    if (mode === 'playing' && onboarding?.menu(action)) continue;
    if (mode === 'panel') padPanel(action);
    else if (mode === 'playing') {
      if (action === 'pause') togglePause();
      else if (action === 'panel' && game.phase === 'playing') openPanel('next');
    } else padMenu(action);
  }
}

function padPanel(action) {
  const panelKey = (code, shiftKey = false) => { if (panel.key({ code, key: code, shiftKey }) === 'close') closePanel(); };
  if (action === 'panel' || action === 'pause') closePanel();
  else if (action === 'nav:back') panelKey('Escape');
  else if (action === 'nav:prev' || action === 'nav:next') panelKey('Tab', action === 'nav:prev');
  else if (NAV_STEPS[action]) panel.moveFocus(NAV_STEPS[action]);
  else if (action === 'slot:rmb') padHold = panel.holdDrop(document.activeElement);
  else if (action === 'nav:ok') {
    const focused = document.activeElement;
    if (focused?.tagName === 'BUTTON' && !focused.disabled && $('monk-panel').contains(focused)) focused.click();
    else panel.moveFocus(1);
  }
}

// Up and down walk the menu stops; left and right on a look choice pick the previous or next one in its row.
function padMenu(action) {
  const focused = document.activeElement;
  const inMenu = !!focused && (overlay.contains(focused) || $('version-update')?.contains(focused));
  if ((action === 'pause' || action === 'nav:back') && mode === 'paused') togglePause();
  else if (action === 'nav:ok') {
    if (inMenu && /^(BUTTON|INPUT)$/.test(focused.tagName) && !focused.disabled) focused.click();
    else if (!playButton.hidden && !playButton.disabled) playButton.click();
  } else if (NAV_STEPS[action] && inMenu && focused.type === 'radio' && (action === 'nav:left' || action === 'nav:right')) {
    const row = [...overlay.querySelectorAll(`input[name="${focused.name}"]`)];
    const next = row[(row.indexOf(focused) + NAV_STEPS[action] + row.length) % row.length];
    next.focus({ preventScroll: true }); next.click();
  } else if (NAV_STEPS[action]) {
    const stops = overlayStops(), index = stops.indexOf(focused);
    if (stops.length) stops[index < 0 ? 0 : (index + NAV_STEPS[action] + stops.length) % stops.length].focus({ preventScroll: true });
  }
}

// Keycaps of the HUD, the pause legend, the panel and the start hint follow the device in use
// (gamepad.js controlKeys). The keyboard legend spells ПРОБЕЛ in capitals.
const LEGEND_KEYS = [['move', 'move'], ['attack', 'attack'], ['dash', 'dash'], ['rmb', 'slot:rmb'], ['q', 'slot:q'],
  ['f', 'slot:f'], ['panel', 'panel'], ['interact', 'interact']];
function showControls(family = gamepad.device === 'pad' ? gamepad.family : null) {
  const keys = family ? controlKeys(family) : currentKeys(), keyboard = !family && !keys.touch;
  document.body.classList.toggle('pad-input', !!family);
  for (const slot of SLOTS) {
    $(`slot-${slot.id}`).querySelector('.keycap').textContent = slotKey(keys, slot.id);
    $(`slot-${slot.id}`).querySelector('.skill-blank').textContent = keys.skills;
  }
  $('interaction-key').textContent = keys.interact;
  for (const [row, action] of LEGEND_KEYS) $(`legend-${row}`).querySelector('kbd').textContent = keyboard && action === 'dash' ? 'ПРОБЕЛ' : keys[action];
  $('legend-system').querySelector('span kbd').textContent = keys.pause;
  $('legend-move').querySelector('span').textContent = keys.touch ? 'движение: палец слева'
    : family ? `движение · ${keys.aim} — прицел` : 'движение · или стрелки';
  $('legend-aim').textContent = keys.touch ? 'Держи «Удар» для серии: удар целится сам. Технику можно навести: потяни палец от кнопки.'
    : `Удерживай ${keys.attack} для серии. ${family ? 'Целься правым стиком.' : 'Целься мышью.'}`;
  $('monk-tabs-hint').textContent = `${keys.tabs} — вкладки`;
  $('monk-close').textContent = keys['nav:back'];
  panel.setKeys(keys);
  if (mode === 'paused') fillLegend();
  if (mode === 'welcome') {
    $('entry-hint').textContent = keys.touch ? 'Джойстик слева\u00a0— идти · «Удар» справа\u00a0— бой'
      : `${keys.move}\u00a0— идти · ${family ? keys.attack : keys.aim}\u00a0— бой · ${keys.interact}\u00a0—\u00a0действие`;
  }
}

// RMB, Q and F rows of the pause legend name the techniques in those slots now (§5.9).
function fillLegend() {
  for (const row of pauseLegend(game, currentKeys())) {
    $(`legend-${row.slot}`).classList.toggle('locked', row.locked || !!row.empty);
    $(`legend-${row.slot}`).querySelector('span').textContent = row.text;
  }
}
document.addEventListener('visibilitychange', () => {
  // HD-2D adaptive: browsers may render no frames while hidden.
  hdAdaptive.suspend();
  if (!document.hidden) return;
  autosave.request();
  setTimeout(() => autosave.flush(), 1000);
  dropHolds();
  if (mode === 'playing' && game.phase === 'playing') showPanel('paused');
});

window.addEventListener('pagehide', () => { autosave.request(); setTimeout(() => autosave.flush(), 1000); });

function currentArea() {
  return game.world.zones?.find(zone => zone.id === game.locationId) ?? game.world;
}

// The map frame shows the canvas at half size and crops render.js captions, which the
// HUD shows itself. Keep a 2× backing store so the tile band fills the frame exactly.
function fitMinimap() {
  const width = Math.round(minimap.clientWidth * 2), height = Math.round(minimap.clientHeight * 2);
  if (width > 0 && height > 0 && (minimap.width !== width || minimap.height !== height)) {
    minimap.width = width; minimap.height = height;
  }
}

// The HUD redraws every 70 ms: a value that did not change is not written again, so an idle HUD dirties
// no style or layout.
const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const setAttr = (element, name, value) => { if (element.getAttribute(name) !== String(value)) element.setAttribute(name, value); };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };

// Orbs (§5.2): the 29u glass fills in whole 1u rows, round(29 × value / max), at least one row above 0.
const ORB_ROWS = 29, ORB_FLOOR = 33;
const orbRows = (value, max) => value > 0 && max > 0 ? Math.max(1, Math.round(ORB_ROWS * Math.min(value, max) / max)) : 0;
function updateOrb(kind, value, max) {
  const rows = orbRows(value, max), orb = $(`${kind}-orb`), text = `<b>${value}</b> <i>/ ${max}</i>`;
  setAttr($(`${kind}-level`), 'y', ORB_FLOOR - rows);
  setAttr($(`${kind}-level`), 'height', rows);
  // The light top row shows only below the brim.
  setAttr($(`${kind}-surface`), 'y', ORB_FLOOR - rows);
  setAttr($(`${kind}-surface`), 'height', rows > 0 && rows < ORB_ROWS ? 1 : 0);
  setAttr(orb, 'aria-valuenow', value);
  setAttr(orb, 'aria-valuemax', max);
  if ($(`${kind}-text`).innerHTML !== text) $(`${kind}-text`).innerHTML = text;
  return orb;
}

// Level frame, the free point mark and ten cells of this level's experience. The fill grows in whole --u.
const roundsWidth = !!window.CSS?.supports?.('width', 'round(down, 50%, 2px)');
let xpFillValue = null;
function updateProgress() {
  const progression = game.progression ?? { xp: 0, level: 1, path: [] };
  const { xp, start, next, fraction } = xpProgress(progression), points = unspentPoints(progression);
  setText($('level-value'), String(progression.level));
  setHidden($('level-points-button'), points < 1);
  setHidden($('point-mark'), points < 1);
  setAttr($('level-points-button'), 'aria-label', `Свободных очков пути: ${points}. Открыть Персонаж`);
  setText($('point-count'), String(points));
  const percent = `${(fraction * 100).toFixed(3)}%`;
  if (xpFillValue !== percent) {
    // A full-width face slides behind the cells; round() still snaps its edge to whole --u.
    if (roundsWidth) $('xp-fill').style.transform = `translateX(calc(round(down, ${percent}, var(--u)) - 100%))`;
    else $('xp-fill').style.width = percent;
    xpFillValue = percent;
  }
  setAttr($('xp-bar'), 'aria-valuenow', next === null ? 1 : xp - start);
  setAttr($('xp-bar'), 'aria-valuemax', next === null ? 1 : next - start);
  setAttr($('xp-bar'), 'aria-valuetext', next === null ? `${xp} опыта · последний уровень` : `${xp} / ${next} опыта`);
}

let pointBurstTimer;
function flashExperience() {
  const button = $('level-points-button');
  clearTimeout(pointBurstTimer);
  button.classList.remove('burst');
  void button.offsetWidth;
  button.classList.add('burst');
  pointBurstTimer = setTimeout(() => button.classList.remove('burst'), 2000);
  $('xp-bar').classList.add('flash');
  setTimeout(() => $('xp-bar').classList.remove('flash'), 90);
}

// Slots LMB · Space · RMB · Q · F (§5.2): ready, cooldown, low spirit, locked «ур. N», empty, new and charges.
// Without a loadout or a progression yet, the HUD shows the level 1 set.
const SLOT_LEVELS = Object.fromEntries(SLOTS.map(slot => [slot.id, slot.unlockLevel]));
const slotIcons = new Map();
const newSkills = new Set();
let hudRun = null;
function updateSlots(spirit) {
  const p = game.player, view = game.loadout ? game : { ...game, loadout: createLoadout() };
  for (const state of slotStates(view)) {
    const element = $(`slot-${state.slot}`), { skill, locked } = state;
    const params = skill && state.slot !== 'lmb' ? skillParams(view, skill) : null;
    element.classList.toggle('locked', locked);
    element.classList.toggle('empty', !locked && !skill);
    element.classList.toggle('new', !locked && newSkills.has(skill));
    element.classList.toggle('insufficient', !locked && !!params && params.cost > spirit);
    if (skill && slotIcons.get(state.slot) !== skill) {
      element.querySelector('.skill-well use').setAttribute('href', `#icon-${skill}`);
      element.querySelector('.skill-name').textContent = SKILLS[skill].name;
      slotIcons.set(state.slot, skill);
    }
    setText(element.querySelector('.skill-unlock'), locked ? `ур. ${SLOT_LEVELS[state.slot]}` : '');
    setText(element.querySelector('.skill-cost'), !locked && params?.cost ? String(params.cost) : '');
    // With charges the cooldown is recharge debt: the slot waits only when no charge is left.
    // The shade scales from the bottom (styles.css), which repaints without a layout.
    const wait = params ? Math.max(0, state.cooldown - (params.charges - 1) * params.cooldown) : 0;
    const shade = element.querySelector('.skill-shade'), share = params?.cooldown > 0 ? String(Math.min(1, wait / params.cooldown)) : '0';
    if (shade.style.getPropertyValue('--shade') !== share) shade.style.setProperty('--shade', share);
    setText(element.querySelector('.cooldown'), wait > .05 ? wait.toFixed(1) : '');
    if (state.slot === 'space') {
      const charges = params?.charges ?? 1, left = params ? charges - Math.ceil(state.cooldown / params.cooldown - 1e-9) : 0;
      setHidden($('charge-pips'), charges < 2);
      [...$('charge-pips').children].forEach((pip, i) => pip.classList.toggle('on', i < left));
    }
  }
  // Series pips under LMB: 3 for the staff and bare hands, 4 for knuckles.
  const strikes = weaponCombo(game.inventory?.equipped?.weapon ?? null).strikes, pips = $('combo-pips');
  if (pips.children.length !== strikes) pips.replaceChildren(...Array.from({ length: strikes }, () => document.createElement('i')));
  [...pips.children].forEach((pip, i) => pip.classList.toggle('on', !!p.attack && i <= p.attack.index));
}

// Loot lines (§5.4): up to three above the spirit orb, newest at the bottom, 3 s each.
function showLootLine(line) {
  lootLines.replaceChildren(...[...lootLines.children, line].slice(-3));
  setTimeout(() => line.remove(), 3000);
}

// Single-target series damage per second against the equipped weapon (bare hands when none).
function lootComparison(item) {
  const equipped = game.inventory?.equipped?.weapon ?? null;
  if (equipped && equipped.family !== item.family) return ['other', 'другое оружие'];
  const scale = game.progression ? damageMultiplier(game.progression, { source: 'combo' }) : 1;
  const gain = comboStats(item, scale).dps - comboStats(equipped, scale).dps;
  return gain > 0 ? ['better', `▲ ${gain} урона/с`] : gain < 0 ? ['worse', `▼ ${-gain} урона/с`] : ['other', 'как надетое'];
}

function itemLine(item) {
  const rarity = RARITIES[item.rarity] ?? RARITIES.common, [tone, comparison] = lootComparison(item);
  const icon = item.family === 'staff' ? 'staff' : item.relic ? 'knuckles-relic' : 'knuckles';
  const line = document.createElement('div'), cell = document.createElement('span'), text = document.createElement('span');
  const label = document.createElement('span'), name = document.createElement('span'), compare = document.createElement('span');
  line.className = 'loot-line'; cell.className = 'loot-icon'; text.className = 'loot-text'; label.className = 'sr-only';
  cell.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><use href="#item-${icon}" /></svg>`
    + (rarity.gems ? `<span class="loot-gems" style="color: var(${rarity.color})">${'<i></i>'.repeat(rarity.gems)}</span>` : '');
  label.textContent = `${rarity.name}: `;
  name.textContent = item.name;
  name.style.color = `var(${rarity.color})`;
  compare.className = `loot-compare ${tone}`;
  compare.textContent = comparison;
  text.append(label, name, compare); line.append(cell, text);
  return line;
}

let bagFullLine = null;
function showBagFull(message) {
  if (bagFullLine?.isConnected) return;
  bagFullLine = document.createElement('div');
  bagFullLine.className = 'loot-line bag-full';
  bagFullLine.textContent = message;
  showLootLine(bagFullLine);
}

// A level-up notice names what opened (§5.3): «Прыжок журавля · слот F · C — путь»,
// or «Отражение · без слота · K — умения» when no slot was free.
function levelNotice(event, learned) {
  const techniques = event.unlocks?.techniques ?? [], modifiers = event.unlocks?.modifiers ?? [], keys = currentKeys();
  const unslotted = techniques.some(id => !learned.get(id));
  const parts = techniques.map(id => `${SKILLS[id].name} · ${learned.get(id) ? `слот ${slotKey(keys, learned.get(id))}` : 'без слота'}`);
  if (!techniques.length && modifiers.length) parts.push('Новые модификаторы');
  if (unslotted || (!techniques.length && modifiers.length)) parts.push(`${keys.skills} — умения`);
  if (event.points && !unslotted) parts.push(`${keys.path} — путь`);
  if (event.points) parts.unshift(`+${event.points} очко пути`);
  notice(parts.join(' · '), `Уровень ${event.level}`);
}

// This frame's progression and loot events: level-up and pack notices, loot lines and the new-skill dot.
function hudEvents(events) {
  panel.observe(events);
  const learned = new Map(events.filter(event => event.type === 'technique-learned').map(event => [event.technique, event.slot]));
  for (const event of events) {
    if (newSkills.has(event.type)) newSkills.delete(event.type);
    if (event.type === 'technique-learned' && event.slot) newSkills.add(event.technique);
    if (event.type === 'level-up') { levelNotice(event, learned); flashExperience(); }
    if (event.type === 'pack-cleared') {
      const xp = events.find(other => other.type === 'xp' && other.source === 'pack');
      notice(xp ? `Стая рассеяна · +${xp.amount} опыта` : 'Стая рассеяна');
    }
    // Below 380 px of height loot lines would cover techniques 2 and 3: they join the notices (mobile-touch §2).
    if (event.type === 'loot-pickup' && event.item) {
      if (touchUI.compactLoot) notice(`${event.item.name} · ${lootComparison(event.item)[1]}`);
      else showLootLine(itemLine(event.item));
    }
    if (event.type === 'bag-full') {
      const message = (event.notice ?? 'Сумка полна · I — выбросить лишнее').replace('I —', `${currentKeys().gear} —`);
      if (touchUI.compactLoot) notice(message); else showBagFull(message);
    }
  }
}

function updateHud() {
  versionCheck.stateChanged();
  const p = game.player;
  const area = currentArea();
  if (hudRun !== game) {
    // A new run starts without new-skill dots or loot lines.
    hudRun = game; newSkills.clear(); slotIcons.clear(); lootLines.replaceChildren();
  }
  const spirit = p.spirit ?? MONK_RULES.spirit.initial;
  const maxSpirit = p.maxSpirit ?? MONK_RULES.spirit.max;
  // A living monk never reads 0 health; spirit shows what a cast can spend. The phone hides the desktop
  // orbs and slots for good (mobile.css): the touch layer draws its own in touchUI.update().
  if (!touchUI.active) {
    updateOrb('health', Math.ceil(p.hp), p.maxHp).classList.toggle('low', p.hp < 35);
    updateOrb('spirit', Math.floor(spirit), maxSpirit).classList.toggle('drained', spirit < 1);
  }
  setHidden($('breath-warning'), p.hp >= 35);
  updateProgress();
  if (!touchUI.active) updateSlots(spirit);
  const monsters = game.enemies.filter(enemy => enemy.kind !== 'ritual'
    && (!enemy.zoneId || enemy.zoneId === game.locationId));
  const remaining = monsters.filter(enemy => enemy.hp > 0).length;
  const ids = `${game.locationId}:${monsters.map(enemy => enemy.id).join(',')}`;
  if (ids !== monsterIds) {
    $('kill-dots').replaceChildren(...monsters.map(() => document.createElement('i')));
    monsterIds = ids;
  }
  setText(killCount, monsters.length ? `${remaining} / ${monsters.length}` : '');
  setText($('encounter-label'), monsters.length ? 'Осталось здесь' : 'Безопасная стоянка');
  setHidden($('kill-dots'), monsters.length === 0);
  [...$('kill-dots').children].forEach((dot, i) => dot.classList.toggle('done', monsters[i].hp <= 0));
  setText($('total-kills'), String(game.adventure.totalKills));
  // The phone shows this block as its map over the pause menu.
  setText($('location-title'), area.title);
  if ($('location-title').title !== area.subtitle) $('location-title').title = area.subtitle;
  setAttr(minimap, 'aria-label', `Карта: ${area.title}`);
  for (const id of zoneIds) {
    const zone = $(`zone-${id}`), visited = !!game.adventure.visited?.includes(id);
    if (sideZoneIds.includes(id)) setHidden(zone, !visited);
    zone.classList.toggle('current', id === game.locationId);
    zone.classList.toggle('visited', visited);
    setAttr(zone, 'aria-current', id === game.locationId ? 'location' : 'false');
  }
  const objective = getObjective(game);
  setText($('quest-title'), objective.title);
  setText($('quest-copy'), objective.copy);
  const prompt = mode === 'playing' && game.phase === 'playing' ? getInteractionPrompt(game) : '';
  setHidden(interactionPrompt, !prompt);
  setText($('interaction-copy'), prompt.replace(/^E\s*[—–:-]\s*/, ''));
  touchUI.update(game, { newSkills, newItems: panel.controller.newItems.size });
}

touchUI.attach();
updateHud();

// The world starts only after the boot splash has preloaded every game file: loadPixelAssets then
// reads them from the browser cache, and the start screen shows with the world ready to play.
function startWorld() {
  try {
    fitMinimap();
    renderer = new Renderer(canvas, $('effects'), minimap, game, { graphics: graphicsSettings(), hd2d: hdAdaptive.settings });
    input = new Input(canvas, renderer, () => mode === 'playing' && game.phase === 'playing' && !onboarding?.paused);
    mountPerf();
    if (crowdCount) window.__crowdPerf = { get game() { return game; }, renderer, get perf() { return perf; }, audio };
    renderer.scene.onDisposeObservable.addOnce(() => perf.dispose());
    // iPhone Safari's toolbars resize and move the visible part without a window resize (render.js reads it).
    const refit = () => { fitMinimap(); renderer.resize(); };
    window.addEventListener('resize', refit);
    for (const type of ['resize', 'scroll']) window.visualViewport?.addEventListener(type, refit);
    let last = performance.now(), lastHud = 0;
    renderer.engine.runRenderLoop(() => {
      perf.frameStart();
      let perfSteps = 0, perfSimMs = 0;
      const now = performance.now();
      // HD-2D adaptive: raw cadence, only during visible, unpaused gameplay.
      hdAdaptive.frame(now, worldReady && mode === 'playing' && game.phase === 'playing' && !onboarding?.paused, document.hidden);
      // HD-2D adaptive: end.
      const dt = Math.min((now - last) / 1000, .05); last = now;
      padButtons(gamepad.poll());
      if (mode === 'playing' && game.phase === 'playing' && !onboarding?.paused) {
        // Full right-stick tilt reaches the crane's range under its current modifier.
        const crane = skillParams(game, 'crane');
        const controls = crowdCount ? crowdControls(game) : touch.sample(game.player, gamepad.sample(game.player, input.sample(game.player), { min: crane.minRange, max: crane.range }));
        let ended = false;
        for (const action of controls.actions) {
          if (action === 'dash') {
            const moving = Math.hypot(controls.moveX, controls.moveY) > .01;
            startDash(game, moving ? controls.moveX : controls.aimX, moving ? controls.moveY : controls.aimY);
          } else if (action.startsWith('slot:')) {
            // RMB, Q and F cast the technique the loadout holds in that slot; a touch cast brings its own aim.
            const aim = controls.aims?.[action] ?? { x: controls.aimX, y: controls.aimY };
            if (useSlot(game, action.slice(5), aim.x, aim.y).reason === 'spirit') {
              notice('Нужно больше духа · попадай обычными ударами');
            }
          }
          else if (action.startsWith('panel:')) {
            openPanel(action.slice(6));
            ended = true;
            break;
          }
          else if (action === 'interact') {
            interact(game);
            if (game.phase !== 'playing') {
              clearInput(); hitStop = 0;
              ended = true;
              break;
            }
          }
        }
        if (ended) updateHud();
        else if (hitStop > 0) hitStop -= dt;
        else {
          accumulator += dt;
          const simStart = perf.enabled ? performance.now() : 0;
          while (accumulator >= STEP) {
            motion.capture(game);
            updateGame(game, controls, STEP);
            accumulator -= STEP;
            if (perf.enabled) perfSteps++;
          }
          if (perf.enabled) perfSimMs = performance.now() - simStart;
        }
        for (const event of game.events) {
          if (event.type === 'impact' && !renderer.reducedMotion) {
            hitStop = Math.max(hitStop, event.strength === 'heavy' ? .045 : .015);
          }
          // A successful deflect holds the frame for 70 ms (§2.3).
          if (event.type === 'deflect-success' && !renderer.reducedMotion) hitStop = Math.max(hitStop, .07);
          if (event.type === 'heal' && event.source !== 'pickup') notice('Святилище возвращает силы');
          if (event.type === 'area-enter') notice(`${currentArea().title} · ${currentArea().subtitle}`);
          if (event.type === 'secret') notice((CACHE_TEXT[event.cache] ?? CACHE_TEXT.secret).notice);
          if (event.type === 'ritual-open') notice('Печать пала. Разбей источник ударами.');
          if (event.type === 'ritual-destroyed') notice('Источник разрушен. Вернись к огню в лагере.');
          if (event.type === 'reward') notice('Янтарная бусина получена · путь завершён');
        }
        hudEvents(game.events);
        // Hits, hurts and the level-up rumble the pad while it is the device in use.
        if (gamepad.device === 'pad' && !renderer.reducedMotion) gamepad.rumbleEvents(game.events);
        // Camp supplies put both weapons in the bag; «Снаряжение» opens for the first choice (§3.6).
        if (mode === 'playing' && game.events.some(event => event.type === 'supplies')) openPanel('gear');
        if (game.phase !== 'playing') {
          clearInput();
          endTimer = setTimeout(() => showPanel(game.phase), 850);
        }
      }
      autosave.events(game.events);
      autosave.flush();
      // Every mode: this frame's events, footsteps, and music that ducks in pause. The panel pauses like the menu.
      const shownMode = mode === 'panel' || onboarding?.paused ? 'paused' : mode;
      guardAudio(() => audio.frame(game, groundMask, shownMode));
      renderer.setTouchView(mode === 'playing' ? touchUI.aimView() : null);
      perf.simDone(perfSteps, perfSimMs);
      const renderStart = perf.enabled ? performance.now() : 0;
      renderer.render(game, dt, shownMode, motion.blend(game, accumulator / STEP));
      perf.renderDone(perf.enabled ? performance.now() - renderStart : 0);
      boot.frame(worldReady && renderer.getAppearanceStatus(game).status !== 'loading');
      if (mode === 'welcome') updateAppearanceStatus();
      if (now - lastHud > 70) { updateHud(); lastHud = now; }
      // Cleared after use: panel actions between frames (equip, drop) reach the next frame's sound.
      updateOnboarding(dt);
      game.events.length = 0;
      perf.frameEnd();
    });
    renderer.ready.then(() => {
      warmGameNavigation(game);
      autosave.prepare();
      worldReady = true;
      boot.worldReady();
      updateAppearanceStatus();
    }).catch(error => {
      console.error(error);
      renderer.engine.stopRenderLoop();
      perf.dispose();
      appearancePicker.hidden = true;
      $('panel-title').textContent = 'Не удалось загрузить мир';
      $('panel-copy').textContent = 'Один из игровых ресурсов не загрузился. Обнови страницу, чтобы попробовать снова.';
      playButton.hidden = true;
      boot.fail($('panel-title').textContent, $('panel-copy').textContent);
    });
  } catch (error) {
    console.error(error);
    appearancePicker.hidden = true;
    $('panel-title').textContent = 'Не удалось открыть мир';
    $('panel-copy').textContent = 'Для игры нужен браузер с WebGL. Включи аппаратное ускорение или попробуй актуальную версию Chrome, Edge, Firefox или Safari.';
    playButton.hidden = true;
    boot.fail($('panel-title').textContent, $('panel-copy').textContent);
  }
}

// A lost file leaves the splash on its message with «Обновить»: no world starts.
boot.preload(selectedAppearance).then(() => { if (!boot.failed) startWorld(); });
